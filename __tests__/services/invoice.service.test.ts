import fs from 'fs';
import os from 'os';
import path from 'path';
import forge from 'node-forge';
// Mocked suite-wide in __tests__/setup.ts, so this resolves to a jest.fn().
import { enqueueAuthorizationCheck } from '../../src/queue/queues';

const firmarXMLMock = jest.fn().mockResolvedValue('<factura>firmada</factura>');
jest.mock('../../src/utils/firma.utils', () => ({
  firmarXML: (...args: any[]) => firmarXMLMock(...args),
}));

// withCompanyP12 is exercised for real in certificate.utils.test.ts; here we
// only need to simulate its contract: call fn with a path/password pair, or
// reject when there is no certificate configured.
const withCompanyP12Mock = jest.fn(async (company: any, fn: (p: string, pw: string) => Promise<any>) => {
  if (!company.certificate || !company.certificate_password) {
    throw new Error('La empresa no tiene certificado digital configurado');
  }
  return fn(p12Path, P12_PASSWORD);
});
const verifyP12PasswordMock = jest.fn().mockResolvedValue({ valid: true });
jest.mock('../../src/utils/certificate.utils', () => ({
  withCompanyP12: (...args: any[]) => (withCompanyP12Mock as any)(...args),
  verifyP12Password: (...args: any[]) => (verifyP12PasswordMock as any)(...args),
}));

const enviarComprobanteSRIMock = jest.fn();
const autorizarComprobanteSRIMock = jest.fn();
jest.mock('../../src/utils/sri.utils', () => ({
  enviarComprobanteSRI: (...args: any[]) => enviarComprobanteSRIMock(...args),
  autorizarComprobanteSRI: (...args: any[]) => autorizarComprobanteSRIMock(...args),
}));

const generateInvoicePDFMock = jest.fn().mockResolvedValue(Buffer.from('pdf'));
jest.mock('../../src/utils/pdf.utils', () => ({
  generateInvoicePDF: (...args: any[]) => generateInvoicePDFMock(...args),
}));

const storageUploadMock = jest
  .fn()
  .mockResolvedValue({ url: 'https://cdn/f.pdf', publicId: 'f-1', provider: 'local', size: 3 });
jest.mock('../../src/services/storage', () => ({
  PDFStorageFactory: { create: () => ({ upload: storageUploadMock, getProviderName: () => 'local' }) },
}));

// --- Model mocks ---
const invoiceStatics = { findOne: jest.fn(), findById: jest.fn() };
const savedInvoices: any[] = [];
jest.mock('../../src/models/Invoice', () => {
  class MockInvoice {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      this._id = 'factura-1';
      savedInvoices.push(this);
    }
    save = jest.fn().mockResolvedValue(this);
    static findOne = (...args: any[]) => invoiceStatics.findOne(...args);
    static findById = (...args: any[]) => invoiceStatics.findById(...args);
  }
  return { __esModule: true, default: MockInvoice };
});

const savedDetails: any[] = [];
jest.mock('../../src/models/InvoiceDetail', () => {
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
jest.mock('../../src/models/InvoicePDF', () => {
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

const identificationTypeStatics = { findOne: jest.fn() };
jest.mock('../../src/models/IdentificationType', () => ({
  __esModule: true,
  default: { findOne: (...args: any[]) => identificationTypeStatics.findOne(...args) },
}));

// Mimics a Mongoose Query: awaitable directly and chainable via .select()
// (used by buscarIssuingCompany to pull in the select:false certificate
// fields).
function mockQuery(value: any) {
  const query: any = Promise.resolve(value);
  query.select = jest.fn().mockResolvedValue(value);
  return query;
}

const issuingCompanyStatics = { findById: jest.fn() };
jest.mock('../../src/models/IssuingCompany', () => ({
  __esModule: true,
  default: { findById: (...args: any[]) => issuingCompanyStatics.findById(...args) },
}));

const clientStatics = { findOne: jest.fn() };
jest.mock('../../src/models/Client', () => ({
  __esModule: true,
  default: { findOne: (...args: any[]) => clientStatics.findOne(...args) },
}));

const productStatics = { findOne: jest.fn() };
jest.mock('../../src/models/Product', () => ({
  __esModule: true,
  default: { findOne: (...args: any[]) => productStatics.findOne(...args) },
}));

// Sequence backs getNextSecuencial (src/utils/sequence.utils.ts): a single
// atomic findOneAndUpdate($inc, upsert) instead of the old
// read-highest-then-increment approach.
const sequenceStatics = { findOneAndUpdate: jest.fn() };
jest.mock('../../src/models/Sequence', () => ({
  __esModule: true,
  default: { findOneAndUpdate: (...args: any[]) => sequenceStatics.findOneAndUpdate(...args) },
}));

import { InvoiceService } from '../../src/services/invoice.service';
import { InvoiceRequest } from '../../src/interfaces/invoice.interface';

const P12_PASSWORD = 'test-p12-password';
let p12Path: string;
let p12Base64: string;

function crearP12(): void {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [
    { shortName: 'CN', value: 'JUAN PEREZ' },
    { shortName: 'C', value: 'EC' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, P12_PASSWORD);
  const buffer = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
  p12Path = path.join(os.tmpdir(), `invoice-svc-test-${Date.now()}.p12`);
  fs.writeFileSync(p12Path, buffer);
  p12Base64 = buffer.toString('base64');
}

const empresaBase = () => ({
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
  toObject() {
    return { ...this };
  },
});

const clienteMock: any = { _id: 'cliente-1', razon_social: 'CLIENTE', identificacion: '0106079783' };
const productoMock: any = { _id: 'producto-1', codigo: 'P001', tiene_iva: true, precio_unitario: 100 };

const requestValido: InvoiceRequest = {
  infoTributaria: { ruc: '1790012345001', claveAcceso: '', secuencial: '' },
  infoFactura: {
    fechaEmision: '17/05/2025',
    tipoIdentificacionComprador: '05',
    identificacionComprador: clienteMock.identificacion,
    razonSocialComprador: 'CLIENTE',
    totalSinImpuestos: '100.00',
    importeTotal: '115.00',
  },
  detalles: [
    {
      detalle: {
        codigoPrincipal: 'P001',
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

beforeAll(() => crearP12());
afterAll(() => {
  if (fs.existsSync(p12Path)) fs.unlinkSync(p12Path);
});

const COMPANY_ID = 'empresa-1';

describe('InvoiceService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    savedInvoices.length = 0;
    savedDetails.length = 0;
    savedPDFs.length = 0;
    identificationTypeStatics.findOne.mockResolvedValue({ codigo: '05' });
    issuingCompanyStatics.findById.mockReturnValue(mockQuery(empresaBase()));
    clientStatics.findOne.mockResolvedValue(clienteMock);
    productStatics.findOne.mockResolvedValue(productoMock);
    invoiceStatics.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(null) });
    let currentSecuencial = 0;
    sequenceStatics.findOneAndUpdate.mockImplementation(async () => {
      currentSecuencial += 1;
      return { current: currentSecuencial };
    });
  });

  describe('validarDatosFactura', () => {
    it('accepts complete data and rejects incomplete data', () => {
      expect(InvoiceService.validarDatosFactura(requestValido)).toBe(true);
      expect(InvoiceService.validarDatosFactura({ ...requestValido, detalles: undefined } as any)).toBe(false);
    });
  });

  describe('generarSecuencial', () => {
    it('starts at 000000001 and increments on each call, atomically via Sequence', async () => {
      const empresa = empresaBase();
      await expect(InvoiceService.generarSecuencial(empresa as any)).resolves.toBe('000000001');
      await expect(InvoiceService.generarSecuencial(empresa as any)).resolves.toBe('000000002');

      expect(sequenceStatics.findOneAndUpdate).toHaveBeenCalledWith(
        {
          empresa_emisora_id: COMPANY_ID,
          tipo_ambiente: 1,
          codigo_establecimiento: '001',
          punto_emision: '001',
          document_type: '01',
        },
        { $inc: { current: 1 } },
        { upsert: true, new: true },
      );
    });

    // The SRI treats pruebas and producción as disjoint numbering universes
    // (the ambiente is its own digit of the clave de acceso), so promoting a
    // tenant must not continue its test numbering into production.
    it('keys the counter per ambiente, so pruebas and producción are separate series', async () => {
      await InvoiceService.generarSecuencial({ ...empresaBase(), tipo_ambiente: 1 } as any);
      await InvoiceService.generarSecuencial({ ...empresaBase(), tipo_ambiente: 2 } as any);

      const [pruebasKey] = sequenceStatics.findOneAndUpdate.mock.calls[0];
      const [produccionKey] = sequenceStatics.findOneAndUpdate.mock.calls[1];
      expect(pruebasKey.tipo_ambiente).toBe(1);
      expect(produccionKey.tipo_ambiente).toBe(2);
      expect(pruebasKey).not.toEqual(produccionKey);
    });

    // Numbering runs per estab-ptoEmi, so moving a tenant to a new emission
    // point must start a fresh series rather than continue the old one.
    it('keys the counter per emission point', async () => {
      await InvoiceService.generarSecuencial({ ...empresaBase(), punto_emision: '001' } as any);
      await InvoiceService.generarSecuencial({ ...empresaBase(), punto_emision: '002' } as any);

      const [first] = sequenceStatics.findOneAndUpdate.mock.calls[0];
      const [second] = sequenceStatics.findOneAndUpdate.mock.calls[1];
      expect(first.punto_emision).toBe('001');
      expect(second.punto_emision).toBe('002');
    });
  });

  describe('buscarIssuingCompany', () => {
    it('returns the empresa without materializing any certificate file', async () => {
      issuingCompanyStatics.findById.mockReturnValue(
        mockQuery({ ...empresaBase(), certificate: p12Base64, certificate_password: P12_PASSWORD }),
      );

      const empresa = await InvoiceService.buscarIssuingCompany(COMPANY_ID);

      // buscarIssuingCompany only fetches the (encrypted) fields; it must no
      // longer write anything to disk. Materializing the P12 happens later,
      // inside procesarEnvioSRI via withCompanyP12, for the shortest possible
      // lifetime.
      expect(empresa?.ruc).toBe('1790012345001');
      expect(empresa?.certificate).toBe(p12Base64);
      expect(empresa?.certificate_password).toBe(P12_PASSWORD);
      // Phase 3: resolved strictly by the authenticated tenant's companyId,
      // never by a RUC taken from the request body.
      expect(issuingCompanyStatics.findById).toHaveBeenCalledWith(COMPANY_ID);
    });

    it('selects the select:false certificate fields explicitly', async () => {
      const selectSpy = jest.fn().mockResolvedValue(empresaBase());
      issuingCompanyStatics.findById.mockReturnValue({ select: selectSpy });

      await InvoiceService.buscarIssuingCompany(COMPANY_ID);

      expect(selectSpy).toHaveBeenCalledWith('+certificate +certificate_password');
    });

    it('returns null when the empresa does not exist', async () => {
      issuingCompanyStatics.findById.mockReturnValue(mockQuery(null));

      await expect(InvoiceService.buscarIssuingCompany('999')).resolves.toBeNull();
    });
  });

  describe('resolveEmpresaAutenticada', () => {
    it('returns the empresa when the body RUC matches the authenticated tenant', async () => {
      const empresa = await InvoiceService.resolveEmpresaAutenticada('1790012345001', COMPANY_ID);

      expect(empresa.ruc).toBe('1790012345001');
    });

    it('throws Empresa emisora no encontrada when the tenant does not exist', async () => {
      issuingCompanyStatics.findById.mockReturnValue(mockQuery(null));

      await expect(InvoiceService.resolveEmpresaAutenticada('1790012345001', 'missing')).rejects.toThrow(
        'Empresa emisora no encontrada',
      );
    });

    it('throws a RUC-mismatch error when the body RUC differs from the authenticated tenant', async () => {
      await expect(InvoiceService.resolveEmpresaAutenticada('9999999999001', COMPANY_ID)).rejects.toThrow(
        'El RUC del comprobante no coincide con la empresa autenticada',
      );
    });
  });

  describe('buscarProducts', () => {
    it('throws when a product is missing', async () => {
      productStatics.findOne.mockResolvedValue(null);

      await expect(InvoiceService.buscarProducts(requestValido.detalles, COMPANY_ID)).rejects.toThrow(
        'Product not found: P001',
      );
    });
  });

  describe('procesarFacturaCompleta', () => {
    it.each([
      [
        'identification type',
        () => identificationTypeStatics.findOne.mockResolvedValue(null),
        'Identification type not found',
      ],
      [
        'empresa',
        () => issuingCompanyStatics.findById.mockReturnValue(mockQuery(null)),
        'Empresa emisora no encontrada',
      ],
      ['client', () => clientStatics.findOne.mockResolvedValue(null), 'Client not found'],
    ])('fails when the %s is missing', async (_n, arrange, mensaje) => {
      arrange();

      await expect(InvoiceService.procesarFacturaCompleta(requestValido, COMPANY_ID)).rejects.toThrow(mensaje);
    });

    it('fails on invalid dates', async () => {
      const invalido = { ...requestValido, infoFactura: { ...requestValido.infoFactura, fechaEmision: 'mala' } };

      await expect(InvoiceService.procesarFacturaCompleta(invalido, COMPANY_ID)).rejects.toThrow('Invalid date format');
    });

    it('fails when the body RUC does not match the authenticated tenant', async () => {
      const invalido = {
        ...requestValido,
        infoTributaria: { ...requestValido.infoTributaria, ruc: '9999999999001' },
      };

      await expect(InvoiceService.procesarFacturaCompleta(invalido, COMPANY_ID)).rejects.toThrow(
        'El RUC del comprobante no coincide con la empresa autenticada',
      );
    });
  });

  describe('crearFacturaCompleta', () => {
    it('creates the invoice with an 01 access key, XML, totals and details', async () => {
      const resultado = await InvoiceService.crearFacturaCompleta(requestValido, COMPANY_ID);

      expect(resultado.factura.clave_acceso).toHaveLength(49);
      expect(resultado.factura.clave_acceso.substring(8, 10)).toBe('01');
      expect(resultado.xml).toContain('<factura id="comprobante" version="1.0.0">');
      expect(resultado.factura.total_iva).toBe(15);
      expect(resultado.factura.total_con_impuestos).toBe(115);
      // The async SRI submission may already have run (no certificate in this test)
      expect(['PENDIENTE', 'ERROR_FIRMA']).toContain(resultado.factura.sri_estado);
      expect(resultado.detalles).toHaveLength(1);
    });
  });

  // P12 helpers: verifyP12Password and the P12 temp-file lifecycle now live
  // in certificate.utils.ts and are covered by certificate.utils.test.ts.
  // convertP12ToPem (previously tested here) had no production caller --
  // deleted along with its tests, see the whole-branch review (L-1).

  describe('procesarEnvioSRI', () => {
    const facturaDoc = () => ({
      _id: 'factura-1',
      xml: '<factura/>',
      clave_acceso: 'clave',
      secuencial: '000000001',
      fecha_emision: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('marks ERROR_FIRMA when there is no certificate', async () => {
      const factura: any = facturaDoc();

      await InvoiceService.procesarEnvioSRI(factura, { certificate: undefined }, clienteMock, [], requestValido);

      expect(factura.sri_estado).toBe('ERROR_FIRMA');
      expect(withCompanyP12Mock).not.toHaveBeenCalled();
    });

    it('signs with the real P12, sends, generates the PDF and schedules authorization on RECIBIDA', async () => {
      enviarComprobanteSRIMock.mockResolvedValue({ estado: 'RECIBIDA' });
      const factura: any = facturaDoc();
      const empresa = { ...empresaBase(), certificate: p12Base64, certificate_password: P12_PASSWORD };

      await InvoiceService.procesarEnvioSRI(factura, empresa, clienteMock, [productoMock], requestValido);

      expect(firmarXMLMock).toHaveBeenCalledWith('<factura/>', p12Path, P12_PASSWORD, '01');
      expect(factura.sri_estado).toBe('RECIBIDA');
      expect(generateInvoicePDFMock).toHaveBeenCalled();
      expect(savedPDFs[0].estado).toBe('GENERADO');
      // The authorization poll is now a queued job rather than an in-process
      // timer; the queue module is mocked suite-wide in __tests__/setup.ts.
      expect(enqueueAuthorizationCheck).toHaveBeenCalledWith('01', 'factura-1');
    });

    it('records the DEVUELTA state without generating a PDF', async () => {
      enviarComprobanteSRIMock.mockResolvedValue({
        estado: 'DEVUELTA',
        mensajes: { mensaje: { identificador: '35' } },
      });
      const factura: any = facturaDoc();
      const empresa = { ...empresaBase(), certificate: p12Base64, certificate_password: P12_PASSWORD };

      await InvoiceService.procesarEnvioSRI(factura, empresa, clienteMock, [], requestValido);

      expect(factura.sri_estado).toBe('DEVUELTA');
      expect(generateInvoicePDFMock).not.toHaveBeenCalled();
    });
  });

  describe('consultarAutorizacionSRI', () => {
    it('updates the invoice when the SRI authorizes it', async () => {
      const factura: any = {
        clave_acceso: 'clave',
        secuencial: '000000001',
        save: jest.fn().mockResolvedValue(undefined),
      };
      invoiceStatics.findById.mockResolvedValue(factura);
      autorizarComprobanteSRIMock.mockResolvedValue({
        estado: 'AUTORIZADO',
        numeroAutorizacion: 'clave',
        fechaAutorizacion: '2025-05-17T12:00:00-05:00',
      });

      const resultado = await InvoiceService.consultarAutorizacionSRI('factura-1');

      expect(resultado?.estado).toBe('AUTORIZADO');
      expect(factura.estado).toBe('AUTORIZADA');
      expect(factura.autorizacion_numero).toBe('clave');
    });

    it('returns null when the invoice does not exist', async () => {
      invoiceStatics.findById.mockResolvedValue(null);

      await expect(InvoiceService.consultarAutorizacionSRI('nope')).resolves.toBeNull();
    });
  });

  describe('generarPDFFactura', () => {
    it('stores an ERROR record when the PDF generation fails', async () => {
      generateInvoicePDFMock.mockRejectedValueOnce(new Error('render failed'));
      const factura: any = {
        _id: 'factura-1',
        clave_acceso: 'clave',
        secuencial: '000000001',
        fecha_emision: new Date(),
      };

      await InvoiceService.generarPDFFactura(factura, empresaBase() as any, clienteMock, [], requestValido);

      expect(savedPDFs[0].estado).toBe('ERROR');
    });
  });
});
