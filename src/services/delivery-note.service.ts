import { DeliveryNoteRequest } from '../interfaces/delivery-note.interface';
import { convertirFecha, generarClaveAcceso } from '../utils/invoice.utils';
import { generarXMLGuiaRemision } from '../utils/xml.utils';
import { firmarXML } from '../utils/firma.utils';
import { enviarComprobanteSRI, autorizarComprobanteSRI, AutorizacionSRI, RespuestaSRI } from '../utils/sri.utils';
import { generateDeliveryNotePDF } from '../utils/pdf.utils';
import { PDFStorageFactory } from './storage';
import { InvoiceService } from './invoice.service';
import { withCompanyP12, verifyP12Password } from '../utils/certificate.utils';
import { getNextSecuencial, type EmissionPoint } from '../utils/sequence.utils';
import { emissionSeriesOf } from '../models/emissionSeries';
import { enqueueAuthorizationCheck, enqueuePdfGeneration } from '../queue/queues';
import { trackBackgroundWork } from '../utils/backgroundWork.utils';
import { recordEmission, recordSriOutcome } from './usage.service';
import DeliveryNote from '../models/DeliveryNote';
import DeliveryNotePDF from '../models/DeliveryNotePDF';

/**
 * Servicio para manejar todas las operaciones relacionadas con guías de remisión (codDoc 06)
 */
export class DeliveryNoteService {
  /**
   * Valida que los datos básicos de una guía de remisión estén presentes
   */
  static validarDatosGuiaRemision(datos: DeliveryNoteRequest): boolean {
    return !!(
      datos.infoTributaria &&
      datos.infoGuiaRemision &&
      datos.infoGuiaRemision.dirPartida &&
      datos.infoGuiaRemision.razonSocialTransportista &&
      datos.infoGuiaRemision.rucTransportista &&
      datos.infoGuiaRemision.placa &&
      datos.destinatarios &&
      datos.destinatarios.length > 0 &&
      datos.destinatarios.every((d) => d.destinatario && d.destinatario.detalles && d.destinatario.detalles.length > 0)
    );
  }

  /**
   * Genera el siguiente secuencial de guía de remisión para una empresa
   * (codDoc '06'), vía el contador atómico compartido.
   */
  static async generarSecuencial(empresa: EmissionPoint): Promise<string> {
    return getNextSecuencial(empresa, '06');
  }

  /**
   * Valida y resuelve todas las entidades necesarias para emitir la guía de remisión
   */
  static async procesarGuiaRemisionCompleta(datos: DeliveryNoteRequest, companyId: string) {
    if (!this.validarDatosGuiaRemision(datos)) {
      throw new Error('Datos de guía de remisión inválidos o incompletos');
    }

    const empresa = await InvoiceService.resolveEmpresaAutenticada(datos.infoTributaria.ruc, companyId);

    const secuencial = await this.generarSecuencial(empresa);
    const fechaEmision = convertirFecha(datos.infoGuiaRemision.fechaEmision);
    const fechaIniTransporte = convertirFecha(datos.infoGuiaRemision.fechaIniTransporte);
    const fechaFinTransporte = convertirFecha(datos.infoGuiaRemision.fechaFinTransporte);

    if (isNaN(fechaEmision.getTime()) || isNaN(fechaIniTransporte.getTime()) || isNaN(fechaFinTransporte.getTime())) {
      throw new Error('Invalid date format');
    }

    return {
      empresa,
      secuencial,
      fechaEmision,
      fechaIniTransporte,
      fechaFinTransporte,
    };
  }

  /**
   * Procesa y guarda una guía de remisión completa,
   * y dispara el envío asíncrono al SRI
   * @param datos Los datos de la guía de remisión recibidos del cliente
   * @param companyId El id de la empresa emisora autenticada (req.auth.companyId)
   * @returns La guía de remisión creada
   */
  static async crearGuiaRemisionCompleta(datos: DeliveryNoteRequest, companyId: string) {
    const { empresa, secuencial, fechaEmision, fechaIniTransporte, fechaFinTransporte } =
      await this.procesarGuiaRemisionCompleta(datos, companyId);

    const serie = `${empresa.codigo_establecimiento}${empresa.punto_emision}`;
    const claveAcceso = generarClaveAcceso({
      fecha: fechaEmision,
      tipoComprobante: '06',
      ruc: empresa.ruc,
      ambiente: empresa.tipo_ambiente.toString(),
      serie,
      secuencial,
      codigoNumerico: Math.floor(10000000 + Math.random() * 89999999).toString(),
      tipoEmision: empresa.tipo_emision.toString(),
    });

    const xml = generarXMLGuiaRemision(datos, empresa, claveAcceso, secuencial);

    const guiaRemision = new DeliveryNote({
      empresa_emisora_id: empresa._id,
      fecha_emision: fechaEmision,
      clave_acceso: claveAcceso,
      secuencial,
      ...emissionSeriesOf(empresa),
      estado: 'CREADA',
      dir_partida: datos.infoGuiaRemision.dirPartida,
      razon_social_transportista: datos.infoGuiaRemision.razonSocialTransportista,
      tipo_identificacion_transportista: datos.infoGuiaRemision.tipoIdentificacionTransportista,
      ruc_transportista: datos.infoGuiaRemision.rucTransportista,
      fecha_ini_transporte: fechaIniTransporte,
      fecha_fin_transporte: fechaFinTransporte,
      placa: datos.infoGuiaRemision.placa,
      destinatarios: datos.destinatarios,
      xml,
      sri_estado: 'PENDIENTE',
      datos_originales: JSON.stringify(datos),
    });

    await guiaRemision.save();

    recordEmission({
      empresaEmisoraId: String(empresa._id),
      documentType: '06',
      documentId: String(guiaRemision._id),
      claveAcceso: guiaRemision.clave_acceso,
      sriEstado: 'PENDIENTE',
    });

    trackBackgroundWork(
      this.procesarEnvioSRI(guiaRemision, empresa, datos).catch((error) => {
        console.error('Error in asynchronous SRI sending process:', error);
      }),
    );

    return {
      guia_remision: guiaRemision,
      xml: guiaRemision.xml,
      xml_firmado: guiaRemision.xml_firmado || null,
      respuesta_sri: null,
    };
  }

  /**
   * Procesa el envío asíncrono de la guía de remisión al SRI:
   * firma XAdES-BES, recepción y consulta de autorización
   */
  static async procesarEnvioSRI(guiaRemision: any, empresa: any, datos: DeliveryNoteRequest): Promise<void> {
    let respuestaSRI: RespuestaSRI | null = null;

    try {
      if (!empresa.certificate || !empresa.certificate_password) {
        guiaRemision.sri_estado = 'ERROR_FIRMA';
        guiaRemision.sri_mensajes = { mensaje: 'Certificate not found for signing' };
        await guiaRemision.save();
        recordSriOutcome(guiaRemision.clave_acceso, guiaRemision.sri_estado);
        return;
      }

      try {
        const xmlFirmado = await withCompanyP12(empresa, async (p12Path, p12Password) => {
          const passwordVerification = await verifyP12Password(p12Path, p12Password);
          if (!passwordVerification.valid) {
            throw new Error(`Error de contraseña del certificado P12: ${passwordVerification.error}`);
          }

          return firmarXML(guiaRemision.xml, p12Path, p12Password, '06');
        });

        guiaRemision.xml_firmado = xmlFirmado;
        guiaRemision.sri_fecha_envio = new Date();
        await guiaRemision.save();

        respuestaSRI = await enviarComprobanteSRI(xmlFirmado);

        guiaRemision.sri_fecha_respuesta = new Date();
        guiaRemision.sri_estado = respuestaSRI.estado;
        if (respuestaSRI.mensajes) {
          guiaRemision.sri_mensajes = respuestaSRI.mensajes;
        }
        await guiaRemision.save();
        recordSriOutcome(guiaRemision.clave_acceso, guiaRemision.sri_estado);

        if (respuestaSRI.estado === 'RECIBIDA') {
          console.log(
            `✅ GUÍA DE REMISIÓN RECIBIDA POR SRI - ID: ${guiaRemision._id}, Clave: ${guiaRemision.clave_acceso}, Secuencial: ${guiaRemision.secuencial}`,
          );
          // No PDF here — the RIDE is generated on AUTORIZADO, not on
          // recepción. See the note in InvoiceService.procesarEnvioSRI.
          await enqueueAuthorizationCheck('06', String(guiaRemision._id));
        } else {
          console.log(`⚠️ SRI Estado: ${respuestaSRI.estado} - Guía de remisión ID: ${guiaRemision._id}`);
        }
      } catch (error: any) {
        console.error('Error during certificate processing or signing:', error.message);
        guiaRemision.sri_estado = 'ERROR_FIRMA';
        guiaRemision.sri_mensajes = { error: error.message };
        await guiaRemision.save();
        recordSriOutcome(guiaRemision.clave_acceso, guiaRemision.sri_estado);
      }
    } catch (error: any) {
      console.error('Error during signing or sending to SRI:', error.message);
      guiaRemision.sri_estado = 'ERROR_PROCESO';
      guiaRemision.sri_mensajes = { error: error.message };
      await guiaRemision.save();
      recordSriOutcome(guiaRemision.clave_acceso, guiaRemision.sri_estado);
    }
  }

  /**
   * Consulta el estado de autorización de una guía de remisión ya recibida por el SRI
   * y actualiza el documento con el resultado
   */
  static async consultarAutorizacionSRI(guiaRemisionId: string): Promise<AutorizacionSRI | null> {
    try {
      const guiaRemision = await DeliveryNote.findById(guiaRemisionId);
      if (!guiaRemision || !guiaRemision.clave_acceso) {
        throw new Error('Guía de remisión no encontrada o sin clave de acceso');
      }

      const respuesta = await autorizarComprobanteSRI(guiaRemision.clave_acceso);

      guiaRemision.sri_estado = respuesta.estado;
      guiaRemision.sri_fecha_respuesta = new Date();
      if (respuesta.mensajes) {
        guiaRemision.sri_mensajes = respuesta.mensajes;
      }

      if (respuesta.estado === 'AUTORIZADO') {
        guiaRemision.estado = 'AUTORIZADA';
        guiaRemision.autorizacion_numero = respuesta.numeroAutorizacion || guiaRemision.clave_acceso;
        guiaRemision.fecha_autorizacion = respuesta.fechaAutorizacion
          ? new Date(respuesta.fechaAutorizacion)
          : new Date();
        console.log(`✅ GUÍA DE REMISIÓN AUTORIZADA POR SRI - Secuencial: ${guiaRemision.secuencial}`);
      }

      await guiaRemision.save();
      recordSriOutcome(guiaRemision.clave_acceso, guiaRemision.sri_estado);

      if (respuesta.estado === 'AUTORIZADO') {
        await enqueuePdfGeneration('06', String(guiaRemision._id));
      }

      return respuesta;
    } catch (error: any) {
      console.error('Error al consultar autorización SRI:', error.message);
      return null;
    }
  }

  /**
   * Genera y almacena el PDF (RIDE) de una guía de remisión recibida por el SRI
   */
  /**
   * Rebuilds the RIDE inputs from persisted state, given only an id — the
   * PDF worker receives nothing else. See InvoiceService.generarPDFDesdeId.
   */
  static async generarPDFDesdeId(guiaRemisionId: string): Promise<void> {
    const guiaRemision = await DeliveryNote.findById(guiaRemisionId);
    if (!guiaRemision) {
      throw new Error(`Guía de remisión ${guiaRemisionId} no encontrada`);
    }
    if (!guiaRemision.datos_originales) {
      throw new Error(`Guía de remisión ${guiaRemisionId} no tiene datos_originales: no se puede regenerar el RIDE`);
    }

    const empresa = await InvoiceService.buscarIssuingCompany(String(guiaRemision.empresa_emisora_id));
    if (!empresa) {
      throw new Error(`La empresa emisora de la guía de remisión ${guiaRemisionId} ya no existe`);
    }

    const datos: DeliveryNoteRequest = JSON.parse(guiaRemision.datos_originales);

    await this.generarPDFGuiaRemision(guiaRemision, empresa, datos);
  }

  static async generarPDFGuiaRemision(guiaRemision: any, empresa: any, datos: DeliveryNoteRequest): Promise<void> {
    try {
      // See generarPDFFactura: the RIDE must carry the SRI's real
      // authorization date, so it cannot be produced before one exists.
      if (!guiaRemision.fecha_autorizacion) {
        throw new Error(
          `No se puede generar el RIDE de la guía de remisión ${guiaRemision.secuencial}: todavía no tiene fecha de autorización del SRI`,
        );
      }
      const numeroAutorizacion = guiaRemision.autorizacion_numero || guiaRemision.clave_acceso;
      const fechaAutorizacion = guiaRemision.fecha_autorizacion;

      const pdfBuffer = await generateDeliveryNotePDF({
        guiaRemision: datos,
        empresa,
        claveAcceso: guiaRemision.clave_acceso,
        secuencial: guiaRemision.secuencial,
        fechaEmision: guiaRemision.fecha_emision,
        numeroAutorizacion,
        fechaAutorizacion,
      });

      const storage = PDFStorageFactory.create();
      const filename = `guia_remision_${guiaRemision.secuencial}_${guiaRemision.clave_acceso}`;
      const uploadResult = await storage.upload(pdfBuffer, filename);

      // Upsert, not insert: claveAcceso is unique, so a regeneration would
      // otherwise throw E11000.
      await DeliveryNotePDF.findOneAndUpdate(
        { claveAcceso: guiaRemision.clave_acceso },
        {
          $set: {
            guia_remision_id: guiaRemision._id,
            pdf_url: uploadResult.url,
            pdf_public_id: uploadResult.publicId,
            pdf_provider: uploadResult.provider,
            tamano_archivo: uploadResult.size,
            numero_autorizacion: numeroAutorizacion,
            fecha_autorizacion: fechaAutorizacion,
            estado: 'GENERADO',
          },
        },
        { upsert: true, new: true },
      );
      console.log(`✅ PDF de guía de remisión guardado: ${uploadResult.url}`);
    } catch (error) {
      console.error('❌ Error generating delivery note PDF:', error);

      try {
        const errorPDF = new DeliveryNotePDF({
          guia_remision_id: guiaRemision._id,
          claveAcceso: guiaRemision.clave_acceso,
          pdf_url: '',
          pdf_public_id: '',
          pdf_provider: 'error',
          tamano_archivo: 0,
          numero_autorizacion: guiaRemision.clave_acceso,
          fecha_autorizacion: new Date(),
          estado: 'ERROR',
        });

        await errorPDF.save();
      } catch (dbError) {
        console.error('❌ Error saving delivery note PDF error record:', dbError);
      }
    }
  }
}
