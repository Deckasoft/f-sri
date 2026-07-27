// Mocked suite-wide in __tests__/setup.ts, so this resolves to a jest.fn().
import { enqueueAuthorizationCheck } from '../../src/queue/queues';

const firmarXMLMock = jest.fn().mockResolvedValue('<guiaRemision>firmada</guiaRemision>');
jest.mock('../../src/utils/firma.utils', () => ({
  firmarXML: (...args: any[]) => firmarXMLMock(...args),
}));

const enviarComprobanteSRIMock = jest.fn();
const autorizarComprobanteSRIMock = jest.fn();
jest.mock('../../src/utils/sri.utils', () => ({
  enviarComprobanteSRI: (...args: any[]) => enviarComprobanteSRIMock(...args),
  autorizarComprobanteSRI: (...args: any[]) => autorizarComprobanteSRIMock(...args),
}));

const generateDeliveryNotePDFMock = jest.fn().mockResolvedValue(Buffer.from('pdf'));
jest.mock('../../src/utils/pdf.utils', () => ({
  generateDeliveryNotePDF: (...args: any[]) => generateDeliveryNotePDFMock(...args),
}));

const storageUploadMock = jest
  .fn()
  .mockResolvedValue({ url: 'https://cdn/gr.pdf', publicId: 'gr-1', provider: 'local', size: 3 });
jest.mock('../../src/services/storage', () => ({
  PDFStorageFactory: { create: () => ({ upload: storageUploadMock, getProviderName: () => 'local' }) },
}));

const invoiceServiceMocks = {
  buscarIssuingCompany: jest.fn(),
  resolveEmpresaAutenticada: jest.fn(),
};
jest.mock('../../src/services/invoice.service', () => ({ InvoiceService: invoiceServiceMocks }));

const withCompanyP12Mock = jest.fn(async (company: any, fn: (p: string, pw: string) => Promise<any>) => {
  if (!company.certificate || !company.certificate_password) {
    throw new Error('La empresa no tiene certificado digital configurado');
  }
  return fn('/tmp/cert.p12', 'test-cert-password');
});
const verifyP12PasswordMock = jest.fn().mockResolvedValue({ valid: true });
jest.mock('../../src/utils/certificate.utils', () => ({
  withCompanyP12: (...args: any[]) => (withCompanyP12Mock as any)(...args),
  verifyP12Password: (...args: any[]) => (verifyP12PasswordMock as any)(...args),
}));

const deliveryNoteStatics = { findOne: jest.fn(), findById: jest.fn() };
jest.mock('../../src/models/DeliveryNote', () => {
  class MockDeliveryNote {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      this._id = 'gr-1';
    }
    save = jest.fn().mockResolvedValue(this);
    static findOne = (...args: any[]) => deliveryNoteStatics.findOne(...args);
    static findById = (...args: any[]) => deliveryNoteStatics.findById(...args);
  }
  return { __esModule: true, default: MockDeliveryNote };
});

const savedPDFs: any[] = [];
jest.mock('../../src/models/DeliveryNotePDF', () => {
  class MockPDF {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      savedPDFs.push(this);
    }
    save = jest.fn().mockResolvedValue(this);
  }
  return { __esModule: true, default: MockPDF };
});

// Sequence backs getNextSecuencial (src/utils/sequence.utils.ts): a single
// atomic findOneAndUpdate($inc, upsert) instead of the old
// read-highest-then-increment approach that used to query DeliveryNote/IssuingCompany.
const sequenceStatics = { findOneAndUpdate: jest.fn() };
jest.mock('../../src/models/Sequence', () => ({
  __esModule: true,
  default: { findOneAndUpdate: (...args: any[]) => sequenceStatics.findOneAndUpdate(...args) },
}));

import { DeliveryNoteService } from '../../src/services/delivery-note.service';
import { DeliveryNoteRequest } from '../../src/interfaces/delivery-note.interface';

const empresaMock: any = {
  _id: 'empresa-1',
  ruc: '1790012345001',
  razon_social: 'EMPRESA DEMO S.A.',
  nombre_comercial: 'DEMO',
  codigo_establecimiento: '001',
  punto_emision: '001',
  tipo_ambiente: 1,
  tipo_emision: 1,
  direccion_matriz: 'Av. Principal',
  direccion_establecimiento: 'Av. Principal',
  obligado_contabilidad: true,
  certificate: 'encrypted-cert-base64',
  certificate_password: 'encrypted-cert-password',
};

const requestValido: DeliveryNoteRequest = {
  infoTributaria: { ruc: empresaMock.ruc, claveAcceso: '', secuencial: '' },
  infoGuiaRemision: {
    fechaEmision: '17/05/2025',
    dirPartida: 'Av. Eloy Alfaro 34',
    razonSocialTransportista: 'Transportes S.A.',
    tipoIdentificacionTransportista: '04',
    rucTransportista: '1796875790001',
    fechaIniTransporte: '17/05/2025',
    fechaFinTransporte: '18/05/2025',
    placa: 'MCL0827',
  },
  destinatarios: [
    {
      destinatario: {
        identificacionDestinatario: '1716849140001',
        razonSocialDestinatario: 'Juan Pérez',
        dirDestinatario: 'Av. Simón Bolívar S/N',
        motivoTraslado: 'Venta',
        detalles: [{ detalle: { descripcion: 'Laptop', cantidad: '10.00' } }],
      },
    },
  ],
};

const COMPANY_ID = empresaMock._id;

describe('DeliveryNoteService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    savedPDFs.length = 0;
    invoiceServiceMocks.buscarIssuingCompany.mockResolvedValue(empresaMock);
    invoiceServiceMocks.resolveEmpresaAutenticada.mockResolvedValue(empresaMock);
    let currentSecuencial = 0;
    sequenceStatics.findOneAndUpdate.mockImplementation(async () => {
      currentSecuencial += 1;
      return { current: currentSecuencial };
    });
  });

  describe('validarDatosGuiaRemision', () => {
    it('accepts a complete request', () => {
      expect(DeliveryNoteService.validarDatosGuiaRemision(requestValido)).toBe(true);
    });

    it('rejects requests without destinatarios, detalles or transport data', () => {
      expect(DeliveryNoteService.validarDatosGuiaRemision({ ...requestValido, destinatarios: [] })).toBe(false);
      expect(
        DeliveryNoteService.validarDatosGuiaRemision({
          ...requestValido,
          destinatarios: [{ destinatario: { ...requestValido.destinatarios[0].destinatario, detalles: [] } }],
        }),
      ).toBe(false);
      expect(
        DeliveryNoteService.validarDatosGuiaRemision({
          ...requestValido,
          infoGuiaRemision: { ...requestValido.infoGuiaRemision, placa: '' },
        }),
      ).toBe(false);
      expect(
        DeliveryNoteService.validarDatosGuiaRemision({
          ...requestValido,
          infoGuiaRemision: { ...requestValido.infoGuiaRemision, rucTransportista: '' },
        }),
      ).toBe(false);
      expect(
        DeliveryNoteService.validarDatosGuiaRemision({
          ...requestValido,
          infoGuiaRemision: { ...requestValido.infoGuiaRemision, dirPartida: '' },
        }),
      ).toBe(false);
      expect(
        DeliveryNoteService.validarDatosGuiaRemision({
          ...requestValido,
          infoGuiaRemision: { ...requestValido.infoGuiaRemision, razonSocialTransportista: '' },
        }),
      ).toBe(false);
    });

    it('rejects an incomplete request through procesarGuiaRemisionCompleta', async () => {
      await expect(
        DeliveryNoteService.procesarGuiaRemisionCompleta({ ...requestValido, destinatarios: [] }, COMPANY_ID),
      ).rejects.toThrow('Datos de guía de remisión inválidos o incompletos');
    });
  });

  describe('generarSecuencial', () => {
    it('starts at 000000001 and increments on each call, atomically via Sequence', async () => {
      await expect(DeliveryNoteService.generarSecuencial(empresaMock)).resolves.toBe('000000001');
      await expect(DeliveryNoteService.generarSecuencial(empresaMock)).resolves.toBe('000000002');

      expect(sequenceStatics.findOneAndUpdate).toHaveBeenCalledWith(
        {
          empresa_emisora_id: COMPANY_ID,
          tipo_ambiente: empresaMock.tipo_ambiente,
          codigo_establecimiento: empresaMock.codigo_establecimiento,
          punto_emision: empresaMock.punto_emision,
          document_type: '06',
        },
        { $inc: { current: 1 } },
        { upsert: true, new: true },
      );
    });
  });

  describe('procesarGuiaRemisionCompleta', () => {
    it('fails when the empresa is missing', async () => {
      invoiceServiceMocks.resolveEmpresaAutenticada.mockRejectedValue(new Error('Empresa emisora no encontrada'));

      await expect(DeliveryNoteService.procesarGuiaRemisionCompleta(requestValido, COMPANY_ID)).rejects.toThrow(
        'Empresa emisora no encontrada',
      );
    });

    it('fails when the body RUC does not match the authenticated tenant', async () => {
      invoiceServiceMocks.resolveEmpresaAutenticada.mockRejectedValue(
        new Error('El RUC del comprobante no coincide con la empresa autenticada'),
      );

      await expect(DeliveryNoteService.procesarGuiaRemisionCompleta(requestValido, COMPANY_ID)).rejects.toThrow(
        'El RUC del comprobante no coincide con la empresa autenticada',
      );
    });

    it('fails on invalid transport dates', async () => {
      const invalido = {
        ...requestValido,
        infoGuiaRemision: { ...requestValido.infoGuiaRemision, fechaFinTransporte: 'mala' },
      };

      await expect(DeliveryNoteService.procesarGuiaRemisionCompleta(invalido, COMPANY_ID)).rejects.toThrow(
        'Invalid date format',
      );
    });
  });

  describe('crearGuiaRemisionCompleta', () => {
    it('creates the delivery note with an 06 access key and transport data', async () => {
      // Skip the real signing flow in the fire-and-forget background call.
      invoiceServiceMocks.resolveEmpresaAutenticada.mockResolvedValue({ ...empresaMock, certificate: undefined });

      const resultado = await DeliveryNoteService.crearGuiaRemisionCompleta(requestValido, COMPANY_ID);

      expect(resultado.guia_remision.clave_acceso).toHaveLength(49);
      expect(resultado.guia_remision.clave_acceso.substring(8, 10)).toBe('06');
      expect(resultado.xml).toContain('<guiaRemision id="comprobante" version="1.1.0">');
      expect(resultado.guia_remision.placa).toBe('MCL0827');
      expect(resultado.guia_remision.destinatarios).toHaveLength(1);
    });

    it('does not fail the creation when the async SRI submission rejects', async () => {
      const envioSpy = jest.spyOn(DeliveryNoteService, 'procesarEnvioSRI').mockRejectedValue(new Error('sri caído'));

      const resultado = await DeliveryNoteService.crearGuiaRemisionCompleta(requestValido, COMPANY_ID);

      expect(resultado.guia_remision.clave_acceso).toHaveLength(49);
      expect(envioSpy).toHaveBeenCalled();
      // give the rejected fire-and-forget promise a tick to settle
      await new Promise((resolve) => setImmediate(resolve));
    });
  });

  describe('procesarEnvioSRI', () => {
    const doc = () => ({
      _id: 'gr-1',
      xml: '<guiaRemision/>',
      clave_acceso: 'clave',
      secuencial: '000000001',
      fecha_emision: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('marks ERROR_FIRMA when there is no certificate', async () => {
      const guia: any = doc();

      await DeliveryNoteService.procesarEnvioSRI(guia, { ...empresaMock, certificate: undefined }, requestValido);

      expect(guia.sri_estado).toBe('ERROR_FIRMA');
    });

    it('signs with tipoDocumento 06 and completes the RECIBIDA flow', async () => {
      verifyP12PasswordMock.mockResolvedValue({ valid: true });
      enviarComprobanteSRIMock.mockResolvedValue({ estado: 'RECIBIDA' });
      const guia: any = doc();

      await DeliveryNoteService.procesarEnvioSRI(guia, empresaMock, requestValido);

      expect(firmarXMLMock).toHaveBeenCalledWith('<guiaRemision/>', '/tmp/cert.p12', 'test-cert-password', '06');
      expect(guia.sri_estado).toBe('RECIBIDA');
      expect(generateDeliveryNotePDFMock).toHaveBeenCalled();
      expect(enqueueAuthorizationCheck).toHaveBeenCalledWith('06', 'gr-1');
    });

    it('records the DEVUELTA state and its mensajes without generating a PDF', async () => {
      verifyP12PasswordMock.mockResolvedValue({ valid: true });
      enviarComprobanteSRIMock.mockResolvedValue({
        estado: 'DEVUELTA',
        mensajes: { mensaje: { identificador: '35' } },
      });
      const guia: any = doc();

      await DeliveryNoteService.procesarEnvioSRI(guia, empresaMock, requestValido);

      expect(guia.sri_estado).toBe('DEVUELTA');
      expect(guia.sri_mensajes).toEqual({ mensaje: { identificador: '35' } });
      expect(generateDeliveryNotePDFMock).not.toHaveBeenCalled();
    });

    it('rejects an invalid/wrong-password P12 as ERROR_FIRMA (no brute-force fallback)', async () => {
      verifyP12PasswordMock.mockResolvedValue({ valid: false, error: 'corrupt' });
      const guia: any = doc();

      await DeliveryNoteService.procesarEnvioSRI(guia, empresaMock, requestValido);

      expect(guia.sri_estado).toBe('ERROR_FIRMA');
      expect(guia.sri_mensajes.error).toContain('P12');
      expect(firmarXMLMock).not.toHaveBeenCalled();
    });

    it('marks ERROR_FIRMA when the signing itself throws', async () => {
      verifyP12PasswordMock.mockResolvedValue({ valid: true });
      firmarXMLMock.mockRejectedValueOnce(new Error('Error al firmar XML: llave dañada'));
      const guia: any = doc();

      await DeliveryNoteService.procesarEnvioSRI(guia, empresaMock, requestValido);

      expect(guia.sri_estado).toBe('ERROR_FIRMA');
      expect(guia.sri_mensajes.error).toContain('firmar');
    });

    it('marks ERROR_PROCESO when persisting the document fails unexpectedly', async () => {
      const guia: any = doc();
      // A failure in the "no certificate" branch's own save() escapes the
      // inner signing try/catch and reaches the outer catch (ERROR_PROCESO).
      guia.save.mockRejectedValueOnce(new Error('EIO: disco dañado'));

      await DeliveryNoteService.procesarEnvioSRI(guia, { ...empresaMock, certificate: undefined }, requestValido);

      expect(guia.sri_estado).toBe('ERROR_PROCESO');
      expect(guia.sri_mensajes.error).toContain('EIO');
    });
  });

  describe('consultarAutorizacionSRI', () => {
    it('updates the delivery note when the SRI authorizes it', async () => {
      const guia: any = {
        clave_acceso: 'clave',
        secuencial: '000000001',
        save: jest.fn().mockResolvedValue(undefined),
      };
      deliveryNoteStatics.findById.mockResolvedValue(guia);
      autorizarComprobanteSRIMock.mockResolvedValue({ estado: 'AUTORIZADO' });

      const resultado = await DeliveryNoteService.consultarAutorizacionSRI('gr-1');

      expect(resultado?.estado).toBe('AUTORIZADO');
      expect(guia.estado).toBe('AUTORIZADA');
      expect(guia.autorizacion_numero).toBe('clave');
    });

    it('returns null when the delivery note does not exist', async () => {
      deliveryNoteStatics.findById.mockResolvedValue(null);

      await expect(DeliveryNoteService.consultarAutorizacionSRI('nope')).resolves.toBeNull();
    });
  });

  describe('generarPDFGuiaRemision', () => {
    it('generates, uploads and records the PDF', async () => {
      const guia: any = {
        _id: 'gr-1',
        clave_acceso: 'clave',
        secuencial: '000000001',
        fecha_emision: new Date(),
        sri_fecha_respuesta: new Date(),
      };

      await DeliveryNoteService.generarPDFGuiaRemision(guia, empresaMock, requestValido);

      expect(generateDeliveryNotePDFMock).toHaveBeenCalledWith(
        expect.objectContaining({ claveAcceso: 'clave', secuencial: '000000001' }),
      );
      expect(storageUploadMock).toHaveBeenCalledWith(expect.any(Buffer), 'guia_remision_000000001_clave');
      expect(savedPDFs[0].estado).toBe('GENERADO');
      expect(savedPDFs[0].pdf_url).toBe('https://cdn/gr.pdf');
    });

    it('stores an ERROR record when the PDF generation fails', async () => {
      generateDeliveryNotePDFMock.mockRejectedValueOnce(new Error('render failed'));
      const guia: any = { _id: 'gr-1', clave_acceso: 'clave', secuencial: '000000001', fecha_emision: new Date() };

      await DeliveryNoteService.generarPDFGuiaRemision(guia, empresaMock, requestValido);

      expect(savedPDFs[0].estado).toBe('ERROR');
    });
  });
});
