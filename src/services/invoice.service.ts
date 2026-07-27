import { CreateInvoiceDTO, InvoiceRequest, ProductDetail, AccessKeyDTO } from '../interfaces/invoice.interface';
import { convertirFecha, generarClaveAcceso } from '../utils/invoice.utils';
import { generarXMLFactura } from '../utils/xml.utils';
import { firmarXML } from '../utils/firma.utils';
import { enviarComprobanteSRI, autorizarComprobanteSRI, RespuestaSRI, AutorizacionSRI } from '../utils/sri.utils';
import { generateInvoicePDF } from '../utils/pdf.utils';
import { PDFStorageFactory } from './storage';
import { withCompanyP12, verifyP12Password } from '../utils/certificate.utils';
import { getNextSecuencial, type EmissionPoint } from '../utils/sequence.utils';
import { emissionSeriesOf } from '../models/emissionSeries';
import { enqueueAuthorizationCheck } from '../queue/queues';
import { trackBackgroundWork } from '../utils/backgroundWork.utils';
import { recordEmission, recordSriOutcome } from './usage.service';
import Invoice from '../models/Invoice';
import InvoiceDetail from '../models/InvoiceDetail';
import InvoicePDF from '../models/InvoicePDF';
import IdentificationType, { IIdentificationType } from '../models/IdentificationType';
import IssuingCompany, { IIssuingCompany } from '../models/IssuingCompany';
import Client, { IClient } from '../models/Client';
import Product, { IProduct } from '../models/Product';

/**
 * Servicio para manejar todas las operaciones relacionadas con facturas
 */
export class InvoiceService {
  /**
   * Valida que los datos básicos de una factura estén presentes
   */
  static validarDatosFactura(invoiceData: InvoiceRequest): boolean {
    return !!(invoiceData.infoTributaria && invoiceData.infoFactura && invoiceData.detalles);
  }

  /**
   * Genera el siguiente secuencial para una empresa (codDoc '01' - factura).
   *
   * Delega en un contador atómico compartido (src/utils/sequence.utils.ts)
   * en vez del antiguo enfoque de "leer el secuencial más alto existente y
   * sumar 1", que podía asignar el mismo secuencial dos veces bajo peticiones
   * concurrentes para el mismo tenant.
   */
  static async generarSecuencial(empresa: EmissionPoint): Promise<string> {
    return getNextSecuencial(empresa, '01');
  }

  /**
   * Busca un tipo de identificación por su código
   */
  static async buscarTipoIdentificacion(codigo: string): Promise<IIdentificationType | null> {
    const tipoIdent = await IdentificationType.findOne({ codigo });
    return tipoIdent;
  }

  /**
   * Busca una empresa emisora por su id (el tenant autenticado vía API key,
   * nunca un valor tomado del cuerpo de la petición).
   *
   * El certificado y su contraseña (cifrados en reposo) están marcados como
   * `select: false` en el esquema, así que se incluyen explícitamente aquí:
   * este es el único punto de lectura compartido por el flujo de firma y
   * envío al SRI de las 5 entidades emitidas por el sistema. A diferencia del
   * comportamiento anterior, esta función ya NO materializa el certificado en
   * un archivo temporal: eso ocurre únicamente dentro de procesarEnvioSRI,
   * justo antes de firmar, a través de withCompanyP12.
   *
   * IMPORTANTE (Phase 3): antes, esta función resolvía la empresa emisora a
   * partir del RUC enviado en el cuerpo de la petición — lo que permitía que
   * cualquier llamador autenticado emitiera un comprobante como CUALQUIER
   * empresa registrada, usando su certificado real. Ahora resuelve
   * exclusivamente por el companyId del tenant autenticado; ver
   * resolveEmpresaAutenticada para la validación cruzada del RUC del cuerpo.
   */
  static async buscarIssuingCompany(companyId: string): Promise<IIssuingCompany | null> {
    return IssuingCompany.findById(companyId).select('+certificate +certificate_password');
  }

  /**
   * Resuelve la empresa emisora autenticada y valida que el RUC declarado en
   * el cuerpo del comprobante coincida con el de esa empresa. El RUC del
   * cuerpo sigue siendo obligatorio (el esquema XML del SRI lo requiere),
   * pero ya no se usa para *seleccionar* qué empresa firma: solo para
   * confirmar que coincide con el tenant autenticado. Un mismatch es un
   * error de validación (400), no un error de servidor.
   */
  static async resolveEmpresaAutenticada(ruc: string, companyId: string): Promise<IIssuingCompany> {
    const empresa = await this.buscarIssuingCompany(companyId);
    if (!empresa) {
      throw new Error('Empresa emisora no encontrada');
    }

    if (ruc !== empresa.ruc) {
      throw new Error('El RUC del comprobante no coincide con la empresa autenticada');
    }

    return empresa;
  }

  /**
   * Busca un cliente por su identificación, dentro del tenant autenticado
   */
  static async buscarClient(identificacion: string, companyId: string): Promise<IClient | null> {
    const cliente = await Client.findOne({ identificacion, empresa_emisora_id: companyId });
    return cliente;
  }

  /**
   * Busca un producto por su código, dentro del tenant autenticado
   */
  static async buscarProduct(codigo: string, companyId: string): Promise<IProduct | null> {
    const producto = await Product.findOne({ codigo, empresa_emisora_id: companyId });
    return producto;
  }

  /**
   * Busca todos los productos listados en los detalles de una factura,
   * dentro del tenant autenticado
   */
  static async buscarProducts(detalles: ProductDetail[], companyId: string): Promise<IProduct[]> {
    const productos = [];
    for (const det of detalles) {
      const codigo = det.detalle?.codigoPrincipal;
      const producto = await this.buscarProduct(codigo, companyId);
      if (!producto) {
        throw new Error(`Product not found: ${codigo}`);
      }
      productos.push(producto);
    }
    return productos;
  }

  /**
   * Crea una nueva factura en la base de datos
   */
  static async crearFactura(datos: CreateInvoiceDTO) {
    const factura = new Invoice({
      empresa_emisora_id: datos.empresaId,
      cliente_id: datos.clienteId,
      fecha_emision: datos.fechaEmision,
      clave_acceso: datos.claveAcceso,
      secuencial: datos.secuencial,
      ...datos.serie,
      estado: 'CREADA',
      total_sin_impuestos: datos.totalSinImpuestos,
      total_iva: datos.totalIva,
      total_con_impuestos: datos.totalConImpuestos,
    });

    await factura.save();
    return factura;
  }

  /**
   * Crea los detalles de una factura en la base de datos
   */
  static async crearDetallesInvoice(facturaId: string | any, detalles: ProductDetail[], products: IProduct[]) {
    const detallesGuardados = [];

    for (let i = 0; i < detalles.length; i++) {
      const det = detalles[i].detalle;
      const prod = products[i];

      const detDoc = new InvoiceDetail({
        factura_id: facturaId,
        producto_id: prod._id,
        cantidad: parseFloat(det.cantidad),
        precio_unitario: parseFloat(det.precioUnitario),
        subtotal: parseFloat(det.precioTotalSinImpuesto),
        valor_iva: parseFloat(det.impuestos[0].impuesto.valor),
      });

      await detDoc.save();
      detallesGuardados.push(detDoc);
    }

    return detallesGuardados;
  }

  /**
   * Procesa la creación completa de una factura y sus detalles
   */
  static async procesarFacturaCompleta(datosFactura: InvoiceRequest, companyId: string) {
    if (!this.validarDatosFactura(datosFactura)) {
      throw new Error('Datos de factura inválidos o incompletos');
    }

    const tipoIdent = await this.buscarTipoIdentificacion(datosFactura.infoFactura.tipoIdentificacionComprador);
    if (!tipoIdent) {
      throw new Error('Identification type not found');
    }

    const empresa = await this.resolveEmpresaAutenticada(datosFactura.infoTributaria.ruc, companyId);

    const cliente = await this.buscarClient(datosFactura.infoFactura.identificacionComprador, companyId);
    if (!cliente) {
      throw new Error('Client not found');
    }

    const productos = await this.buscarProducts(datosFactura.detalles, companyId);
    const secuencial = await this.generarSecuencial(empresa);
    const fechaEmision = convertirFecha(datosFactura.infoFactura.fechaEmision);

    if (isNaN(fechaEmision.getTime())) {
      throw new Error('Invalid date format');
    }

    return {
      empresa,
      cliente,
      productos,
      secuencial,
      fechaEmision,
    };
  }

  /**
   * Procesa y guarda una factura completa con todos sus detalles
   * @param datosFactura Los datos de la factura recibidos del cliente
   * @param companyId El id de la empresa emisora autenticada (req.auth.companyId)
   * @returns La factura creada y sus detalles
   */
  static async crearFacturaCompleta(datosFactura: InvoiceRequest, companyId: string) {
    const { empresa, cliente, productos, secuencial, fechaEmision } = await this.procesarFacturaCompleta(
      datosFactura,
      companyId,
    );

    const serie = `${empresa.codigo_establecimiento}${empresa.punto_emision}`;
    const claveAcceso = generarClaveAcceso({
      fecha: fechaEmision,
      tipoComprobante: '01',
      ruc: empresa.ruc,
      ambiente: empresa.tipo_ambiente.toString(),
      serie,
      secuencial,
      codigoNumerico: Math.floor(10000000 + Math.random() * 89999999).toString(),
      tipoEmision: empresa.tipo_emision.toString(),
    });

    const totalSinImpuestos = parseFloat(datosFactura.infoFactura.totalSinImpuestos);
    const totalIva = datosFactura.detalles.reduce(
      (s: number, d: any) => s + parseFloat(d.detalle.impuestos[0].impuesto.valor),
      0,
    );
    const totalConImpuestos = parseFloat(datosFactura.infoFactura.importeTotal);

    const xml = generarXMLFactura(datosFactura, empresa, cliente, productos, claveAcceso, secuencial);

    const facturaCreada = await this.crearFactura({
      empresaId: empresa._id,
      clienteId: cliente._id,
      fechaEmision,
      claveAcceso,
      secuencial,
      serie: emissionSeriesOf(empresa),
      totalSinImpuestos,
      totalIva,
      totalConImpuestos,
    });

    facturaCreada.xml = xml;
    facturaCreada.sri_estado = 'PENDIENTE';
    facturaCreada.datos_originales = JSON.stringify(datosFactura);
    await facturaCreada.save();

    recordEmission({
      empresaEmisoraId: String(empresa._id),
      documentType: '01',
      documentId: String(facturaCreada._id),
      claveAcceso: facturaCreada.clave_acceso,
      sriEstado: 'PENDIENTE',
    });

    trackBackgroundWork(
      this.procesarEnvioSRI(facturaCreada, empresa, cliente, productos, datosFactura).catch((error) => {
        console.error('Error in asynchronous SRI sending process:', error);
      }),
    );

    const detallesGuardados = await this.crearDetallesInvoice(facturaCreada._id, datosFactura.detalles, productos);

    return {
      factura: facturaCreada,
      detalles: detallesGuardados,
      xml: facturaCreada.xml,
      xml_firmado: facturaCreada.xml_firmado || null,
      respuesta_sri: null,
    };
  }

  /**
   * Procesa el envío asíncrono de la factura al SRI
   * @param factura La factura a enviar
   * @param empresa La empresa emisora
   * @param cliente El cliente
   * @param productos Los productos
   * @param datosFactura Los datos originales de la factura
   */
  static async procesarEnvioSRI(
    factura: any,
    empresa: any,
    cliente: IClient,
    productos: IProduct[],
    datosFactura: InvoiceRequest,
  ): Promise<void> {
    let respuestaSRI: RespuestaSRI | null = null;

    try {
      if (!empresa.certificate || !empresa.certificate_password) {
        factura.sri_estado = 'ERROR_FIRMA';
        factura.sri_mensajes = { mensaje: 'Certificate not found for signing' };
        await factura.save();
        recordSriOutcome(factura.clave_acceso, factura.sri_estado);
        return;
      }

      try {
        // withCompanyP12 materializes the (encrypted-at-rest) P12 into a
        // short-lived temp file for the duration of this callback only, and
        // guarantees it is deleted afterwards, success or failure.
        const xmlFirmado = await withCompanyP12(empresa, async (p12Path, p12Password) => {
          const passwordVerification = await verifyP12Password(p12Path, p12Password);
          if (!passwordVerification.valid) {
            throw new Error(`Error de contraseña del certificado P12: ${passwordVerification.error}`);
          }

          // Sign directly from the P12 using the SRI-compliant XAdES-BES signer
          return firmarXML(factura.xml, p12Path, p12Password, '01');
        });

        factura.xml_firmado = xmlFirmado;
        await factura.save();

        if (factura.xml_firmado) {
          factura.sri_fecha_envio = new Date();
          await factura.save();

          respuestaSRI = await enviarComprobanteSRI(factura.xml_firmado);

          factura.sri_fecha_respuesta = new Date();
          factura.sri_estado = respuestaSRI.estado;
          if (respuestaSRI.mensajes) {
            factura.sri_mensajes = respuestaSRI.mensajes;
          }
          await factura.save();
          recordSriOutcome(factura.clave_acceso, factura.sri_estado);

          if (respuestaSRI.estado === 'RECIBIDA') {
            console.log(
              `✅ FACTURA RECIBIDA POR SRI - ID: ${factura._id}, Clave: ${factura.clave_acceso}, Secuencial: ${factura.secuencial}`,
            );
            await this.generarPDFFactura(factura, empresa, cliente, productos, datosFactura);
            await enqueueAuthorizationCheck('01', String(factura._id));
          } else {
            console.log(`⚠️ SRI Estado: ${respuestaSRI.estado} - Factura ID: ${factura._id}`);
          }
        }
      } catch (error: any) {
        console.error('Error during certificate conversion or signing:', error.message);
        factura.sri_estado = 'ERROR_FIRMA';
        factura.sri_mensajes = { error: error.message };
        await factura.save();
        recordSriOutcome(factura.clave_acceso, factura.sri_estado);
      }
    } catch (error: any) {
      console.error('Error during signing or sending to SRI:', error.message);
      factura.sri_estado = 'ERROR_PROCESO';
      factura.sri_mensajes = { error: error.message };
      await factura.save();
      recordSriOutcome(factura.clave_acceso, factura.sri_estado);
    }
  }

  /**
   * Generates and saves PDF when invoice is approved by SRI
   * Uses the configured storage provider (Cloudinary, Local, etc.)
   * @param factura The approved invoice
   * @param empresa The issuing company
   * @param cliente The client
   * @param productos The products
   * @param datosFactura Original invoice data
   */
  static async generarPDFFactura(
    factura: any,
    empresa: IIssuingCompany,
    cliente: IClient,
    productos: IProduct[],
    datosFactura: InvoiceRequest,
  ): Promise<void> {
    try {
      const numeroAutorizacion = factura.clave_acceso;
      const fechaAutorizacion = factura.sri_fecha_respuesta || new Date();

      // Preparar datos para generar el PDF
      const pdfData = {
        factura: datosFactura,
        empresa,
        cliente,
        productos,
        claveAcceso: factura.clave_acceso,
        secuencial: factura.secuencial,
        fechaEmision: factura.fecha_emision,
        numeroAutorizacion,
        fechaAutorizacion,
      };

      // Generar el PDF en memoria
      console.log(`📄 Generando PDF para factura: ${factura.secuencial}`);
      const pdfBuffer = await generateInvoicePDF(pdfData);

      // Obtener el proveedor de almacenamiento configurado
      const storage = PDFStorageFactory.create();
      const filename = `factura_${factura.secuencial}_${factura.clave_acceso}`;

      // Subir el PDF al proveedor de almacenamiento
      console.log(`⬆️  Subiendo PDF usando proveedor: ${storage.getProviderName()}`);
      const uploadResult = await storage.upload(pdfBuffer, filename);

      // Guardar la información del PDF en la base de datos
      // IMPORTANTE: Ya NO guardamos el pdf_buffer para ahorrar espacio
      const invoicePDF = new InvoicePDF({
        factura_id: factura._id,
        claveAcceso: factura.clave_acceso,
        pdf_url: uploadResult.url, // Key de S3 (proveedor s3) o URL pública (cloudinary/local) -- ver src/models/InvoicePDF.ts
        pdf_public_id: uploadResult.publicId, // ID para eliminar/gestionar el archivo
        pdf_provider: uploadResult.provider, // Proveedor usado (cloudinary, local, etc.)
        tamano_archivo: uploadResult.size,
        numero_autorizacion: numeroAutorizacion,
        fecha_autorizacion: fechaAutorizacion,
        estado: 'GENERADO',
      });

      await invoicePDF.save();
      console.log(`✅ PDF guardado exitosamente: ${uploadResult.url}`);
    } catch (error) {
      console.error('❌ Error generating PDF:', error);

      try {
        // Registrar el error en la base de datos
        const errorPDF = new InvoicePDF({
          factura_id: factura._id,
          claveAcceso: factura.clave_acceso,
          pdf_url: '',
          pdf_public_id: '',
          pdf_provider: 'error',
          tamano_archivo: 0,
          numero_autorizacion: factura.clave_acceso,
          fecha_autorizacion: new Date(),
          estado: 'ERROR',
        });

        await errorPDF.save();
      } catch (dbError) {
        console.error('❌ Error saving PDF error record:', dbError);
      }
    }
  }

  /**
   * Consulta el estado de autorización de una factura ya recibida por el SRI
   * y actualiza el documento con el resultado.
   * En el esquema offline el número de autorización es la propia clave de acceso.
   * @param facturaId ID de la factura a consultar
   */
  static async consultarAutorizacionSRI(facturaId: string): Promise<AutorizacionSRI | null> {
    try {
      const factura = await Invoice.findById(facturaId);
      if (!factura || !factura.clave_acceso) {
        throw new Error('Factura no encontrada o sin clave de acceso');
      }

      const respuesta = await autorizarComprobanteSRI(factura.clave_acceso);

      factura.sri_estado = respuesta.estado;
      factura.sri_fecha_respuesta = new Date();
      if (respuesta.mensajes) {
        factura.sri_mensajes = respuesta.mensajes;
      }

      if (respuesta.estado === 'AUTORIZADO') {
        factura.estado = 'AUTORIZADA';
        factura.autorizacion_numero = respuesta.numeroAutorizacion || factura.clave_acceso;
        factura.fecha_autorizacion = respuesta.fechaAutorizacion ? new Date(respuesta.fechaAutorizacion) : new Date();
        console.log(`✅ FACTURA AUTORIZADA POR SRI - Secuencial: ${factura.secuencial}`);
      }

      await factura.save();
      recordSriOutcome(factura.clave_acceso, factura.sri_estado);
      return respuesta;
    } catch (error: any) {
      console.error('Error al consultar autorización SRI:', error.message);
      return null;
    }
  }
}
