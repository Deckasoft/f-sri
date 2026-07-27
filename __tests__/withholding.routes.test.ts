import request from 'supertest';
import { createApp } from '../src/testApp';

// --- Model mocks ---
// Behavior is NOT configured here: every default lives in seedMockDefaults()
// below, which beforeEach re-applies after jest.resetAllMocks(). See the
// comment on beforeEach for why the reset has to be resetAllMocks and not
// clearAllMocks.
const withholdingInstanceMocks = {
  save: jest.fn(),
};

const withholdingStaticMocks = {
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findOneAndDelete: jest.fn(),
};

const savedWithholdings: any[] = [];
jest.mock('../src/models/Withholding', () => {
  class MockWithholding {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      this._id = 'ret-1';
      savedWithholdings.push(this);
    }
    save = withholdingInstanceMocks.save;
    static find = (...args: any[]) => withholdingStaticMocks.find(...args);
    static findById = (...args: any[]) => withholdingStaticMocks.findById(...args);
    static findOne = (...args: any[]) => withholdingStaticMocks.findOne(...args);
    static findByIdAndUpdate = (...args: any[]) => withholdingStaticMocks.findByIdAndUpdate(...args);
    static findByIdAndDelete = (...args: any[]) => withholdingStaticMocks.findByIdAndDelete(...args);
    static findOneAndUpdate = (...args: any[]) => withholdingStaticMocks.findOneAndUpdate(...args);
    static findOneAndDelete = (...args: any[]) => withholdingStaticMocks.findOneAndDelete(...args);
  }
  return { __esModule: true, default: MockWithholding };
});

const withholdingPDFStaticMocks = {
  findOne: jest.fn(),
};

jest.mock('../src/models/WithholdingPDF', () => ({
  __esModule: true,
  default: {
    findOne: (...args: any[]) => withholdingPDFStaticMocks.findOne(...args),
  },
}));

// --- Service mock ---
const crearRetencionCompletaMock = jest.fn();
jest.mock('../src/services/withholding.service', () => ({
  WithholdingService: {
    crearRetencionCompleta: (...args: any[]) => crearRetencionCompletaMock(...args),
  },
}));

// --- ApiKey mock (apiKeyAuth runs on every /api/v1/* request) ---
const apiKeyStaticMocks = {
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
};
jest.mock('../src/models/ApiKey', () => ({
  __esModule: true,
  default: {
    findOne: (...args: any[]) => {
      const result = Promise.resolve(apiKeyStaticMocks.findOne(...args));
      const query: any = result;
      query.populate = () => result;
      return query;
    },
    findByIdAndUpdate: (...args: any[]) => apiKeyStaticMocks.findByIdAndUpdate(...args),
  },
}));
/**
 * The baseline behavior every test starts from. Kept in one function because
 * beforeEach wipes ALL mock behavior (jest.resetAllMocks) and then re-applies
 * it, which is what makes each test's mock state independent of whatever ran
 * before it.
 */
const seedMockDefaults = (): void => {
  withholdingInstanceMocks.save.mockResolvedValue({});
  withholdingStaticMocks.find.mockResolvedValue([]);
  withholdingStaticMocks.findById.mockResolvedValue(null);
  withholdingStaticMocks.findOne.mockResolvedValue(null);
  withholdingStaticMocks.findByIdAndUpdate.mockResolvedValue(null);
  withholdingStaticMocks.findByIdAndDelete.mockResolvedValue(null);
  withholdingStaticMocks.findOneAndUpdate.mockResolvedValue(null);
  withholdingStaticMocks.findOneAndDelete.mockResolvedValue(null);
  withholdingPDFStaticMocks.findOne.mockResolvedValue(null);
  apiKeyStaticMocks.findOne.mockResolvedValue({
    _id: 'api-key-1',
    revoked_at: undefined,
    last_used_at: undefined,
    empresa_emisora_id: { _id: 'company-1', active: true },
  });
  apiKeyStaticMocks.findByIdAndUpdate.mockResolvedValue(null);
};

seedMockDefaults();

const app = createApp();
const authHeader = 'sk_live_test_token_1234567890';

const retencionPayload = {
  infoTributaria: { ruc: '1790012345001' },
  infoCompRetencion: {
    fechaEmision: '17/05/2025',
    tipoIdentificacionSujetoRetenido: '04',
    razonSocialSujetoRetenido: 'Proveedor S.A.',
    identificacionSujetoRetenido: '1713328506001',
    periodoFiscal: '05/2025',
  },
  docsSustento: [],
};

describe('Withholding routes', () => {
  beforeEach(() => {
    // resetAllMocks, NOT clearAllMocks. clearAllMocks only wipes recorded
    // calls; it leaves any still-queued mockResolvedValueOnce/
    // mockRejectedValueOnce value sitting in the mock's one-shot queue. Those
    // queues are consumed in FIFO order, so a single value that its own test
    // never consumed is silently handed to the NEXT test that calls the same
    // mock, shifting every subsequent value by one and producing results that
    // look like two tests swapped their outcomes.
    //
    // A test can fail to consume what it queued without doing anything wrong:
    // if its HTTP request dies before reaching the handler (this suite does
    // intermittently produce "socket hang up" under full-suite load), the
    // queued value is simply never read. That made the corruption both
    // order-dependent and attributed to the wrong test.
    //
    // resetAllMocks drains those queues along with the call records, so each
    // test starts from a known state no matter what happened before it;
    // seedMockDefaults puts the baseline behavior back.
    jest.resetAllMocks();
    seedMockDefaults();
  });

  describe('POST /api/v1/withholding/complete', () => {
    it('requires authentication', async () => {
      const res = await request(app).post('/api/v1/withholding/complete').send({});
      expect(res.status).toBe(401);
    });

    it('returns 400 when retencion is missing', async () => {
      const res = await request(app).post('/api/v1/withholding/complete').set('X-API-Key', authHeader).send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(crearRetencionCompletaMock).not.toHaveBeenCalled();
    });

    it('creates a complete withholding and returns its XML', async () => {
      const resultadoMock = {
        retencion: { secuencial: '000000001', clave_acceso: '123' },
        xml: '<comprobanteRetencion/>',
        xml_firmado: null,
        respuesta_sri: null,
      };
      crearRetencionCompletaMock.mockResolvedValueOnce(resultadoMock);

      const res = await request(app)
        .post('/api/v1/withholding/complete')
        .set('X-API-Key', authHeader)
        .send({ retencion: retencionPayload });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.xml).toBe('<comprobanteRetencion/>');
      expect(crearRetencionCompletaMock).toHaveBeenCalledWith(retencionPayload, 'company-1');
    });

    it('returns 400 when the body RUC does not match the authenticated tenant', async () => {
      crearRetencionCompletaMock.mockRejectedValueOnce(
        new Error('El RUC del comprobante no coincide con la empresa autenticada'),
      );

      const res = await request(app)
        .post('/api/v1/withholding/complete')
        .set('X-API-Key', authHeader)
        .send({ retencion: retencionPayload });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('no coincide');
    });

    it('returns 400 for validation errors from the service', async () => {
      crearRetencionCompletaMock.mockRejectedValueOnce(
        new Error('Datos de comprobante de retención inválidos o incompletos'),
      );

      const res = await request(app)
        .post('/api/v1/withholding/complete')
        .set('X-API-Key', authHeader)
        .send({ retencion: retencionPayload });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('inválidos');
    });

    it('returns 500 for unexpected service errors', async () => {
      crearRetencionCompletaMock.mockRejectedValueOnce(new Error('mongo down'));

      const res = await request(app)
        .post('/api/v1/withholding/complete')
        .set('X-API-Key', authHeader)
        .send({ retencion: retencionPayload });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('CRUD endpoints', () => {
    it('lists only the tenant’s own withholdings', async () => {
      withholdingStaticMocks.find.mockResolvedValueOnce([{ secuencial: '000000001' }]);

      const res = await request(app).get('/api/v1/withholding').set('X-API-Key', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(withholdingStaticMocks.find).toHaveBeenCalledWith({ empresa_emisora_id: 'company-1' });
    });

    it('returns 404 for a missing/cross-tenant withholding', async () => {
      const res = await request(app).get('/api/v1/withholding/507f1f77bcf86cd799439011').set('X-API-Key', authHeader);

      expect(res.status).toBe(404);
    });

    it('returns a withholding by id scoped to the tenant', async () => {
      withholdingStaticMocks.findOne.mockResolvedValueOnce({ secuencial: '000000001' });

      const res = await request(app).get('/api/v1/withholding/507f1f77bcf86cd799439011').set('X-API-Key', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.secuencial).toBe('000000001');
    });

    it('returns the PDF info of a withholding that belongs to the tenant', async () => {
      withholdingStaticMocks.findOne.mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011' });
      withholdingPDFStaticMocks.findOne.mockResolvedValueOnce({ pdf_url: 'https://cdn/pdf.pdf', estado: 'GENERADO' });

      const res = await request(app)
        .get('/api/v1/withholding/507f1f77bcf86cd799439011/pdf')
        .set('X-API-Key', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.pdf_url).toBe('https://cdn/pdf.pdf');
    });

    it('404s the PDF lookup when the withholding belongs to another tenant', async () => {
      const res = await request(app)
        .get('/api/v1/withholding/507f1f77bcf86cd799439011/pdf')
        .set('X-API-Key', authHeader);

      expect(res.status).toBe(404);
      expect(withholdingPDFStaticMocks.findOne).not.toHaveBeenCalled();
    });

    it('deletes a withholding scoped to the tenant', async () => {
      withholdingStaticMocks.findOneAndDelete.mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011' });

      const res = await request(app)
        .delete('/api/v1/withholding/507f1f77bcf86cd799439011')
        .set('X-API-Key', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Deleted');
      expect(withholdingStaticMocks.findOneAndDelete).toHaveBeenCalledWith({
        _id: '507f1f77bcf86cd799439011',
        empresa_emisora_id: 'company-1',
      });
    });
  });
});
