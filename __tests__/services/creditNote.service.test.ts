// Mocked suite-wide in __tests__/setup.ts, so this resolves to a jest.fn().
import { enqueueAuthorizationCheck } from '../../src/queue/queues';

// --- Mocks for collaborators ---
const firmarXMLMock = jest.fn().mockResolvedValue('<notaCredito>firmada</notaCredito>');
jest.mock('../../src/utils/firma.utils', () => ({
  firmarXML: (...args: any[]) => firmarXMLMock(...args),
}));

const enviarComprobanteSRIMock = jest.fn();
const autorizarComprobanteSRIMock = jest.fn();
jest.mock('../../src/utils/sri.utils', () => ({
  enviarComprobanteSRI: (...args: any[]) => enviarComprobanteSRIMock(...args),
  autorizarComprobanteSRI: (...args: any[]) => autorizarComprobanteSRIMock(...args),
}));

const generateCreditNotePDFMock = jest.fn().mockResolvedValue(Buffer.from('pdf'));
jest.mock('../../src/utils/pdf.utils', () => ({
  generateCreditNotePDF: (...args: any[]) => generateCreditNotePDFMock(...args),
}));

const storageUploadMock = jest.fn().mockResolvedValue({
  url: 'https://cdn/nc.pdf',
  publicId: 'nc-1',
  provider: 'local',
  size: 3,
});
jest.mock('../../src/services/storage', () => ({
  PDFStorageFactory: { create: () => ({ upload: storageUploadMock, getProviderName: () => 'local' }) },
}));

const invoiceServiceMocks = {
  buscarTipoIdentificacion: jest.fn(),
  buscarIssuingCompany: jest.fn(),
  resolveEmpresaAutenticada: jest.fn(),
  buscarClient: jest.fn(),
  buscarProduct: jest.fn(),
};
jest.mock('../../src/services/invoice.service', () => ({
  InvoiceService: invoiceServiceMocks,
}));

// withCompanyP12's real temp-file lifecycle is covered by
// certificate.utils.test.ts; here we just need to simulate its contract.
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

// --- Model mocks ---
const savedCreditNotes: any[] = [];
const creditNoteStatics = {
  findOne: jest.fn(),
  findById: jest.fn(),
};
jest.mock('../../src/models/CreditNote', () => {
  class MockCreditNote {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      this._id = 'cn-1';
      savedCreditNotes.push(this);
    }
    save = jest.fn().mockResolvedValue(this);
    static findOne = (...args: any[]) => creditNoteStatics.findOne(...args);
    static findById = (...args: any[]) => creditNoteStatics.findById(...args);
  }
  return { __esModule: true, default: MockCreditNote };
});

const savedDetails: any[] = [];
jest.mock('../../src/models/CreditNoteDetail', () => {
  class MockDetail {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      savedDetails.push(this);
    }
    save = jest.fn().mockResolvedValue(this);
  }
  return { __esModule: true, default: MockDetail };
});

const savedPDFs: any[] = [];
jest.mock('../../src/models/CreditNotePDF', () => {
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

const invoiceStatics = { findOne: jest.fn().mockResolvedValue(null) };
jest.mock('../../src/models/Invoice', () => ({
  __esModule: true,
  default: { findOne: (...args: any[]) => invoiceStatics.findOne(...args) },
}));

// Sequence backs getNextSecuencial (src/utils/sequence.utils.ts): a single
// atomic findOneAndUpdate($inc, upsert) instead of the old
// read-highest-then-increment approach that used to query CreditNote/IssuingCompany.
const sequenceStatics = { findOneAndUpdate: jest.fn() };
jest.mock('../../src/models/Sequence', () => ({
  __esModule: true,
  default: { findOneAndUpdate: (...args: any[]) => sequenceStatics.findOneAndUpdate(...args) },
}));

import { CreditNoteService } from '../../src/services/credit-note.service';
import { CreditNoteRequest } from '../../src/interfaces/credit-note.interface';

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

const clienteMock: any = { _id: 'cliente-1', razon_social: 'CLIENTE', identificacion: '0106079783' };
const productoMock: any = { _id: 'producto-1', codigo: 'P001' };

const requestValido: CreditNoteRequest = {
  infoTributaria: { ruc: empresaMock.ruc, claveAcceso: '', secuencial: '' },
  infoNotaCredito: {
    fechaEmision: '17/05/2025',
    tipoIdentificacionComprador: '05',
    identificacionComprador: clienteMock.identificacion,
    codDocModificado: '01',
    numDocModificado: '001-001-000000123',
    fechaEmisionDocSustento: '10/05/2025',
    totalSinImpuestos: '100.00',
    valorModificacion: '115.00',
    motivo: 'DEVOLUCIÓN',
  },
  detalles: [
    {
      detalle: {
        codigoInterno: 'P001',
        descripcion: 'Laptop',
        cantidad: '1.00',
        precioUnitario: '100.00',
        precioTotalSinImpuesto: '100.00',
        impuestos: [
          {
            impuesto: { codigo: '2', codigoPorcentaje: '4', tarifa: '15.00', baseImponible: '100.00', valor: '15.00' },
          },
        ],
      },
    },
  ],
};

const COMPANY_ID = empresaMock._id;

function prepararLookupsFelices() {
  invoiceServiceMocks.buscarTipoIdentificacion.mockResolvedValue({ codigo: '05' });
  invoiceServiceMocks.buscarIssuingCompany.mockResolvedValue(empresaMock);
  invoiceServiceMocks.resolveEmpresaAutenticada.mockResolvedValue(empresaMock);
  invoiceServiceMocks.buscarClient.mockResolvedValue(clienteMock);
  invoiceServiceMocks.buscarProduct.mockResolvedValue(productoMock);
  let currentSecuencial = 0;
  sequenceStatics.findOneAndUpdate.mockImplementation(async () => {
    currentSecuencial += 1;
    return { current: currentSecuencial };
  });
}

describe('CreditNoteService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    savedCreditNotes.length = 0;
    savedDetails.length = 0;
    savedPDFs.length = 0;
    prepararLookupsFelices();
  });

  describe('validarDatosNotaCredito', () => {
    it('accepts a complete request', () => {
      expect(CreditNoteService.validarDatosNotaCredito(requestValido)).toBe(true);
    });

    it('rejects requests without detalles or motivo', () => {
      expect(CreditNoteService.validarDatosNotaCredito({ ...requestValido, detalles: [] })).toBe(false);
      expect(
        CreditNoteService.validarDatosNotaCredito({
          ...requestValido,
          infoNotaCredito: { ...requestValido.infoNotaCredito, motivo: '' },
        }),
      ).toBe(false);
    });
  });

  describe('generarSecuencial', () => {
    it('starts at 000000001 and increments on each call, atomically via Sequence', async () => {
      await expect(CreditNoteService.generarSecuencial(empresaMock)).resolves.toBe('000000001');
      await expect(CreditNoteService.generarSecuencial(empresaMock)).resolves.toBe('000000002');

      expect(sequenceStatics.findOneAndUpdate).toHaveBeenCalledWith(
        {
          empresa_emisora_id: COMPANY_ID,
          tipo_ambiente: empresaMock.tipo_ambiente,
          codigo_establecimiento: empresaMock.codigo_establecimiento,
          punto_emision: empresaMock.punto_emision,
          document_type: '04',
        },
        { $inc: { current: 1 } },
        { upsert: true, new: true },
      );
    });
  });

  describe('procesarNotaCreditoCompleta', () => {
    it.each([
      [
        'identification type',
        () => invoiceServiceMocks.buscarTipoIdentificacion.mockResolvedValue(null),
        'Identification type not found',
      ],
      [
        'empresa',
        () =>
          invoiceServiceMocks.resolveEmpresaAutenticada.mockRejectedValue(new Error('Empresa emisora no encontrada')),
        'Empresa emisora no encontrada',
      ],
      [
        'RUC mismatch',
        () =>
          invoiceServiceMocks.resolveEmpresaAutenticada.mockRejectedValue(
            new Error('El RUC del comprobante no coincide con la empresa autenticada'),
          ),
        'El RUC del comprobante no coincide con la empresa autenticada',
      ],
      ['client', () => invoiceServiceMocks.buscarClient.mockResolvedValue(null), 'Client not found'],
      ['product', () => invoiceServiceMocks.buscarProduct.mockResolvedValue(null), 'Product not found'],
    ])('fails when the %s is missing', async (_name, arrange, mensaje) => {
      arrange();

      await expect(CreditNoteService.procesarNotaCreditoCompleta(requestValido, COMPANY_ID)).rejects.toThrow(mensaje);
    });

    it('fails on invalid dates', async () => {
      const invalido = {
        ...requestValido,
        infoNotaCredito: { ...requestValido.infoNotaCredito, fechaEmision: 'fecha-mala' },
      };

      await expect(CreditNoteService.procesarNotaCreditoCompleta(invalido, COMPANY_ID)).rejects.toThrow(
        'Invalid date format',
      );
    });

    it('resolves every entity and links the modified invoice when it exists', async () => {
      invoiceStatics.findOne.mockResolvedValue({ _id: 'factura-99' });

      const resultado = await CreditNoteService.procesarNotaCreditoCompleta(requestValido, COMPANY_ID);

      expect(resultado.empresa).toBe(empresaMock);
      expect(resultado.cliente).toBe(clienteMock);
      expect(resultado.secuencial).toBe('000000001');
      expect(resultado.facturaModificada).toEqual({ _id: 'factura-99' });
      expect(invoiceStatics.findOne).toHaveBeenCalledWith(expect.objectContaining({ secuencial: '000000123' }));
    });
  });

  describe('crearNotaCreditoCompleta', () => {
    beforeEach(() => {
      // Skip the real signing flow in the fire-and-forget background call by
      // resolving an empresa without a certificate configured.
      invoiceServiceMocks.resolveEmpresaAutenticada.mockResolvedValue({ ...empresaMock, certificate: undefined });
    });

    it('creates the credit note with an 04 access key, XML and details', async () => {
      const resultado = await CreditNoteService.crearNotaCreditoCompleta(requestValido, COMPANY_ID);

      expect(resultado.nota_credito.clave_acceso).toHaveLength(49);
      expect(resultado.nota_credito.clave_acceso.substring(8, 10)).toBe('04');
      expect(resultado.xml).toContain('<notaCredito id="comprobante" version="1.1.0">');
      expect(resultado.nota_credito.total_iva).toBe(15);
      expect(resultado.nota_credito.valor_modificacion).toBe(115);
      expect(resultado.detalles).toHaveLength(1);
      expect(savedDetails[0].producto_id).toBe('producto-1');
    });
  });

  describe('procesarEnvioSRI', () => {
    const notaCreditoDoc: any = () => ({
      _id: 'cn-1',
      xml: '<notaCredito/>',
      clave_acceso: 'clave',
      secuencial: '000000001',
      fecha_emision: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('marks ERROR_FIRMA when there is no certificate', async () => {
      const doc = notaCreditoDoc();

      await CreditNoteService.procesarEnvioSRI(
        doc,
        { ...empresaMock, certificate: undefined },
        clienteMock,
        [],
        requestValido,
      );

      expect(doc.sri_estado).toBe('ERROR_FIRMA');
      expect(firmarXMLMock).not.toHaveBeenCalled();
    });

    it('signs with tipoDocumento 04, sends, generates the PDF and schedules authorization on RECIBIDA', async () => {
      verifyP12PasswordMock.mockResolvedValue({ valid: true });
      enviarComprobanteSRIMock.mockResolvedValue({ estado: 'RECIBIDA' });
      const doc = notaCreditoDoc();

      await CreditNoteService.procesarEnvioSRI(doc, empresaMock, clienteMock, [productoMock], requestValido);

      expect(firmarXMLMock).toHaveBeenCalledWith('<notaCredito/>', '/tmp/cert.p12', 'test-cert-password', '04');
      expect(doc.xml_firmado).toBe('<notaCredito>firmada</notaCredito>');
      expect(doc.sri_estado).toBe('RECIBIDA');
      expect(generateCreditNotePDFMock).toHaveBeenCalled();
      expect(savedPDFs[0].estado).toBe('GENERADO');
      expect(enqueueAuthorizationCheck).toHaveBeenCalledWith('04', 'cn-1');
    });

    it('records the DEVUELTA state without generating a PDF', async () => {
      verifyP12PasswordMock.mockResolvedValue({ valid: true });
      enviarComprobanteSRIMock.mockResolvedValue({
        estado: 'DEVUELTA',
        mensajes: { mensaje: { identificador: '35' } },
      });
      const doc = notaCreditoDoc();

      await CreditNoteService.procesarEnvioSRI(doc, empresaMock, clienteMock, [], requestValido);

      expect(doc.sri_estado).toBe('DEVUELTA');
      expect(doc.sri_mensajes).toEqual({ mensaje: { identificador: '35' } });
      expect(generateCreditNotePDFMock).not.toHaveBeenCalled();
    });

    it('marks ERROR_FIRMA when the password is wrong (no brute-force fallback)', async () => {
      verifyP12PasswordMock.mockResolvedValue({ valid: false, error: 'bad mac' });
      const doc = notaCreditoDoc();

      await CreditNoteService.procesarEnvioSRI(doc, empresaMock, clienteMock, [], requestValido);

      expect(doc.sri_estado).toBe('ERROR_FIRMA');
      expect(doc.sri_mensajes.error).toContain('contraseña');
      expect(firmarXMLMock).not.toHaveBeenCalled();
    });
  });

  describe('consultarAutorizacionSRI', () => {
    it('updates the credit note when the SRI authorizes it', async () => {
      const doc: any = {
        clave_acceso: 'clave',
        secuencial: '000000001',
        save: jest.fn().mockResolvedValue(undefined),
      };
      creditNoteStatics.findById.mockResolvedValue(doc);
      autorizarComprobanteSRIMock.mockResolvedValue({
        estado: 'AUTORIZADO',
        numeroAutorizacion: 'clave',
        fechaAutorizacion: '2025-05-17T12:00:00-05:00',
      });

      const resultado = await CreditNoteService.consultarAutorizacionSRI('cn-1');

      expect(resultado?.estado).toBe('AUTORIZADO');
      expect(doc.estado).toBe('AUTORIZADA');
      expect(doc.autorizacion_numero).toBe('clave');
      expect(doc.fecha_autorizacion).toBeInstanceOf(Date);
      expect(doc.save).toHaveBeenCalled();
    });

    it('keeps the document pending when the SRI is still processing', async () => {
      const doc: any = { clave_acceso: 'clave', save: jest.fn().mockResolvedValue(undefined) };
      creditNoteStatics.findById.mockResolvedValue(doc);
      autorizarComprobanteSRIMock.mockResolvedValue({ estado: 'EN PROCESO' });

      const resultado = await CreditNoteService.consultarAutorizacionSRI('cn-1');

      expect(resultado?.estado).toBe('EN PROCESO');
      expect(doc.estado).toBeUndefined();
    });

    it('returns null when the credit note does not exist', async () => {
      creditNoteStatics.findById.mockResolvedValue(null);

      await expect(CreditNoteService.consultarAutorizacionSRI('nope')).resolves.toBeNull();
    });
  });

  describe('generarPDFNotaCredito', () => {
    it('stores an ERROR record when the PDF generation fails', async () => {
      generateCreditNotePDFMock.mockRejectedValueOnce(new Error('render failed'));
      const doc: any = {
        _id: 'cn-1',
        clave_acceso: 'clave',
        secuencial: '000000001',
        fecha_emision: new Date(),
      };

      await CreditNoteService.generarPDFNotaCredito(doc, empresaMock, clienteMock, [], requestValido);

      expect(savedPDFs[0].estado).toBe('ERROR');
      expect(savedPDFs[0].pdf_provider).toBe('error');
    });
  });
});
