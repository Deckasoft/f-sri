// Mocked suite-wide in __tests__/setup.ts, so this resolves to a jest.fn().
import { enqueueAuthorizationCheck } from '../../src/queue/queues';

const firmarXMLMock = jest.fn().mockResolvedValue('<notaDebito>firmada</notaDebito>');
jest.mock('../../src/utils/firma.utils', () => ({
  firmarXML: (...args: any[]) => firmarXMLMock(...args),
}));

const enviarComprobanteSRIMock = jest.fn();
const autorizarComprobanteSRIMock = jest.fn();
jest.mock('../../src/utils/sri.utils', () => ({
  enviarComprobanteSRI: (...args: any[]) => enviarComprobanteSRIMock(...args),
  autorizarComprobanteSRI: (...args: any[]) => autorizarComprobanteSRIMock(...args),
}));

const generateDebitNotePDFMock = jest.fn().mockResolvedValue(Buffer.from('pdf'));
jest.mock('../../src/utils/pdf.utils', () => ({
  generateDebitNotePDF: (...args: any[]) => generateDebitNotePDFMock(...args),
}));

const storageUploadMock = jest
  .fn()
  .mockResolvedValue({ url: 'https://cdn/nd.pdf', publicId: 'nd-1', provider: 'local', size: 3 });
jest.mock('../../src/services/storage', () => ({
  PDFStorageFactory: { create: () => ({ upload: storageUploadMock, getProviderName: () => 'local' }) },
}));

const invoiceServiceMocks = {
  buscarTipoIdentificacion: jest.fn(),
  buscarIssuingCompany: jest.fn(),
  resolveEmpresaAutenticada: jest.fn(),
  buscarClient: jest.fn(),
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

const debitNoteStatics = { findOne: jest.fn(), findById: jest.fn() };
const savedDebitNotes: any[] = [];
jest.mock('../../src/models/DebitNote', () => {
  class MockDebitNote {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      this._id = 'nd-1';
      savedDebitNotes.push(this);
    }
    save = jest.fn().mockResolvedValue(this);
    static findOne = (...args: any[]) => debitNoteStatics.findOne(...args);
    static findById = (...args: any[]) => debitNoteStatics.findById(...args);
  }
  return { __esModule: true, default: MockDebitNote };
});

const savedPDFs: any[] = [];
jest.mock('../../src/models/DebitNotePDF', () => {
  class MockPDF {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      savedPDFs.push(this);
    }
    save = jest.fn().mockResolvedValue(this);
    // The success path upserts by claveAcceso rather than constructing a
    // document (claveAcceso is unique, so regenerating would throw E11000),
    // so record that payload into savedPDFs too — the assertions read it.
    static findOneAndUpdate = jest.fn((filter: any, update: any) => {
      const doc = { ...filter, ...update.$set };
      savedPDFs.push(doc);
      return Promise.resolve(doc);
    });
  }
  return { __esModule: true, default: MockPDF };
});

jest.mock('../../src/models/Invoice', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null) },
}));

// Sequence backs getNextSecuencial (src/utils/sequence.utils.ts): a single
// atomic findOneAndUpdate($inc, upsert) instead of the old
// read-highest-then-increment approach that used to query DebitNote/IssuingCompany.
const sequenceStatics = { findOneAndUpdate: jest.fn() };
jest.mock('../../src/models/Sequence', () => ({
  __esModule: true,
  default: { findOneAndUpdate: (...args: any[]) => sequenceStatics.findOneAndUpdate(...args) },
}));

import { DebitNoteService } from '../../src/services/debit-note.service';
import { DebitNoteRequest } from '../../src/interfaces/debit-note.interface';

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
const COMPANY_ID = empresaMock._id;

const requestValido: DebitNoteRequest = {
  infoTributaria: { ruc: empresaMock.ruc, claveAcceso: '', secuencial: '' },
  infoNotaDebito: {
    fechaEmision: '17/05/2025',
    tipoIdentificacionComprador: '05',
    identificacionComprador: clienteMock.identificacion,
    codDocModificado: '01',
    numDocModificado: '001-001-000000123',
    fechaEmisionDocSustento: '10/05/2025',
    totalSinImpuestos: '50.00',
    impuestos: [
      { impuesto: { codigo: '2', codigoPorcentaje: '4', tarifa: '15.00', baseImponible: '50.00', valor: '7.50' } },
    ],
    valorTotal: '57.50',
    pagos: [{ pago: { formaPago: '20', total: '57.50' } }],
  },
  motivos: [{ motivo: { razon: 'Interés por mora', valor: '50.00' } }],
};

describe('DebitNoteService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    savedDebitNotes.length = 0;
    savedPDFs.length = 0;
    invoiceServiceMocks.buscarTipoIdentificacion.mockResolvedValue({ codigo: '05' });
    invoiceServiceMocks.buscarIssuingCompany.mockResolvedValue(empresaMock);
    invoiceServiceMocks.resolveEmpresaAutenticada.mockResolvedValue(empresaMock);
    invoiceServiceMocks.buscarClient.mockResolvedValue(clienteMock);
    let currentSecuencial = 0;
    sequenceStatics.findOneAndUpdate.mockImplementation(async () => {
      currentSecuencial += 1;
      return { current: currentSecuencial };
    });
  });

  describe('validarDatosNotaDebito', () => {
    it('accepts a complete request', () => {
      expect(DebitNoteService.validarDatosNotaDebito(requestValido)).toBe(true);
    });

    it('rejects requests without motivos, impuestos or pagos', () => {
      expect(DebitNoteService.validarDatosNotaDebito({ ...requestValido, motivos: [] })).toBe(false);
      expect(
        DebitNoteService.validarDatosNotaDebito({
          ...requestValido,
          infoNotaDebito: { ...requestValido.infoNotaDebito, impuestos: [] },
        }),
      ).toBe(false);
      expect(
        DebitNoteService.validarDatosNotaDebito({
          ...requestValido,
          infoNotaDebito: { ...requestValido.infoNotaDebito, pagos: [] },
        }),
      ).toBe(false);
    });
  });

  describe('generarSecuencial', () => {
    it('starts at 000000001 and increments on each call, atomically via Sequence', async () => {
      await expect(DebitNoteService.generarSecuencial(empresaMock)).resolves.toBe('000000001');
      await expect(DebitNoteService.generarSecuencial(empresaMock)).resolves.toBe('000000002');

      expect(sequenceStatics.findOneAndUpdate).toHaveBeenCalledWith(
        {
          empresa_emisora_id: COMPANY_ID,
          tipo_ambiente: empresaMock.tipo_ambiente,
          codigo_establecimiento: empresaMock.codigo_establecimiento,
          punto_emision: empresaMock.punto_emision,
          document_type: '05',
        },
        { $inc: { current: 1 } },
        { upsert: true, new: true },
      );
    });
  });

  describe('procesarNotaDebitoCompleta', () => {
    it('fails when the client is missing', async () => {
      invoiceServiceMocks.buscarClient.mockResolvedValue(null);

      await expect(DebitNoteService.procesarNotaDebitoCompleta(requestValido, COMPANY_ID)).rejects.toThrow(
        'Client not found',
      );
    });

    it('fails when the body RUC does not match the authenticated tenant', async () => {
      invoiceServiceMocks.resolveEmpresaAutenticada.mockRejectedValue(
        new Error('El RUC del comprobante no coincide con la empresa autenticada'),
      );

      await expect(DebitNoteService.procesarNotaDebitoCompleta(requestValido, COMPANY_ID)).rejects.toThrow(
        'El RUC del comprobante no coincide con la empresa autenticada',
      );
    });

    it('fails on invalid dates', async () => {
      const invalido = {
        ...requestValido,
        infoNotaDebito: { ...requestValido.infoNotaDebito, fechaEmisionDocSustento: 'mala' },
      };

      await expect(DebitNoteService.procesarNotaDebitoCompleta(invalido, COMPANY_ID)).rejects.toThrow(
        'Invalid date format',
      );
    });
  });

  describe('crearNotaDebitoCompleta', () => {
    it('creates the debit note with an 05 access key, totals and motivos', async () => {
      // Skip the real signing flow in the fire-and-forget background call.
      invoiceServiceMocks.resolveEmpresaAutenticada.mockResolvedValue({ ...empresaMock, certificate: undefined });

      const resultado = await DebitNoteService.crearNotaDebitoCompleta(requestValido, COMPANY_ID);

      expect(resultado.nota_debito.clave_acceso).toHaveLength(49);
      expect(resultado.nota_debito.clave_acceso.substring(8, 10)).toBe('05');
      expect(resultado.xml).toContain('<notaDebito id="comprobante" version="1.0.0">');
      expect(resultado.nota_debito.total_impuestos).toBe(7.5);
      expect(resultado.nota_debito.valor_total).toBe(57.5);
      expect(resultado.nota_debito.motivos).toEqual([{ razon: 'Interés por mora', valor: 50 }]);
    });
  });

  describe('procesarEnvioSRI', () => {
    const doc = () => ({
      _id: 'nd-1',
      xml: '<notaDebito/>',
      clave_acceso: 'clave',
      secuencial: '000000001',
      fecha_emision: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('marks ERROR_FIRMA when there is no certificate', async () => {
      const nota: any = doc();

      await DebitNoteService.procesarEnvioSRI(
        nota,
        { ...empresaMock, certificate: undefined },
        clienteMock,
        requestValido,
      );

      expect(nota.sri_estado).toBe('ERROR_FIRMA');
    });

    it('signs with tipoDocumento 05 and completes the RECIBIDA flow', async () => {
      verifyP12PasswordMock.mockResolvedValue({ valid: true });
      enviarComprobanteSRIMock.mockResolvedValue({ estado: 'RECIBIDA' });
      const nota: any = doc();

      await DebitNoteService.procesarEnvioSRI(nota, empresaMock, clienteMock, requestValido);

      expect(firmarXMLMock).toHaveBeenCalledWith('<notaDebito/>', '/tmp/cert.p12', 'test-cert-password', '05');
      expect(nota.sri_estado).toBe('RECIBIDA');
      // No RIDE on recepción — it is generated once the SRI authorizes the
      // comprobante. See the invoice service test for the reasoning.
      expect(generateDebitNotePDFMock).not.toHaveBeenCalled();
      expect(enqueueAuthorizationCheck).toHaveBeenCalledWith('05', 'nd-1');
    });

    it('records signing errors as ERROR_FIRMA', async () => {
      verifyP12PasswordMock.mockResolvedValue({ valid: false, error: 'corrupt' });
      const nota: any = doc();

      await DebitNoteService.procesarEnvioSRI(nota, empresaMock, clienteMock, requestValido);

      expect(nota.sri_estado).toBe('ERROR_FIRMA');
      expect(nota.sri_mensajes.error).toContain('P12');
    });
  });

  describe('consultarAutorizacionSRI', () => {
    it('updates the debit note when the SRI authorizes it', async () => {
      const nota: any = {
        clave_acceso: 'clave',
        secuencial: '000000001',
        save: jest.fn().mockResolvedValue(undefined),
      };
      debitNoteStatics.findById.mockResolvedValue(nota);
      autorizarComprobanteSRIMock.mockResolvedValue({ estado: 'AUTORIZADO', numeroAutorizacion: 'clave' });

      const resultado = await DebitNoteService.consultarAutorizacionSRI('nd-1');

      expect(resultado?.estado).toBe('AUTORIZADO');
      expect(nota.estado).toBe('AUTORIZADA');
    });

    it('returns null when the debit note does not exist', async () => {
      debitNoteStatics.findById.mockResolvedValue(null);

      await expect(DebitNoteService.consultarAutorizacionSRI('nope')).resolves.toBeNull();
    });
  });

  describe('generarPDFNotaDebito', () => {
    it('stores an ERROR record when the PDF generation fails', async () => {
      generateDebitNotePDFMock.mockRejectedValueOnce(new Error('render failed'));
      const nota: any = { _id: 'nd-1', clave_acceso: 'clave', secuencial: '000000001', fecha_emision: new Date() };

      await DebitNoteService.generarPDFNotaDebito(nota, empresaMock, clienteMock, requestValido);

      expect(savedPDFs[0].estado).toBe('ERROR');
    });
  });
});
