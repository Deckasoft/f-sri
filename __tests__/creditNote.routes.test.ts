import request from 'supertest';
import { createApp } from '../src/testApp';

// --- Model mocks ---
// Behavior is NOT configured here: every default lives in seedMockDefaults()
// below, which beforeEach re-applies after jest.resetAllMocks(). See the
// comment on beforeEach for why the reset has to be resetAllMocks and not
// clearAllMocks.
const creditNoteInstanceMocks = {
  save: jest.fn(),
};

const creditNoteStaticMocks = {
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findOneAndDelete: jest.fn(),
};

const savedCreditNotes: any[] = [];
jest.mock('../src/models/CreditNote', () => {
  class MockCreditNote {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      this._id = 'cn-1';
      savedCreditNotes.push(this);
    }
    save = creditNoteInstanceMocks.save;
    static find = (...args: any[]) => creditNoteStaticMocks.find(...args);
    static findById = (...args: any[]) => creditNoteStaticMocks.findById(...args);
    static findOne = (...args: any[]) => creditNoteStaticMocks.findOne(...args);
    static findByIdAndUpdate = (...args: any[]) => creditNoteStaticMocks.findByIdAndUpdate(...args);
    static findByIdAndDelete = (...args: any[]) => creditNoteStaticMocks.findByIdAndDelete(...args);
    static findOneAndUpdate = (...args: any[]) => creditNoteStaticMocks.findOneAndUpdate(...args);
    static findOneAndDelete = (...args: any[]) => creditNoteStaticMocks.findOneAndDelete(...args);
  }
  return { __esModule: true, default: MockCreditNote };
});

const creditNotePDFStaticMocks = {
  findOne: jest.fn(),
};

jest.mock('../src/models/CreditNotePDF', () => ({
  __esModule: true,
  default: {
    findOne: (...args: any[]) => creditNotePDFStaticMocks.findOne(...args),
  },
}));

// --- Service mock ---
const crearNotaCreditoCompletaMock = jest.fn();
jest.mock('../src/services/credit-note.service', () => ({
  CreditNoteService: {
    crearNotaCreditoCompleta: (...args: any[]) => crearNotaCreditoCompletaMock(...args),
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
  creditNoteInstanceMocks.save.mockResolvedValue({});
  creditNoteStaticMocks.find.mockResolvedValue([]);
  creditNoteStaticMocks.findById.mockResolvedValue(null);
  creditNoteStaticMocks.findOne.mockResolvedValue(null);
  creditNoteStaticMocks.findByIdAndUpdate.mockResolvedValue(null);
  creditNoteStaticMocks.findByIdAndDelete.mockResolvedValue(null);
  creditNoteStaticMocks.findOneAndUpdate.mockResolvedValue(null);
  creditNoteStaticMocks.findOneAndDelete.mockResolvedValue(null);
  creditNotePDFStaticMocks.findOne.mockResolvedValue(null);
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

const notaCreditoPayload = {
  infoTributaria: { ruc: '1790012345001' },
  infoNotaCredito: {
    fechaEmision: '17/05/2025',
    tipoIdentificacionComprador: '05',
    identificacionComprador: '0106079783',
    codDocModificado: '01',
    numDocModificado: '001-001-000000123',
    fechaEmisionDocSustento: '10/05/2025',
    totalSinImpuestos: '100.00',
    valorModificacion: '115.00',
    motivo: 'DEVOLUCIÓN',
  },
  detalles: [],
};

describe('Credit note routes', () => {
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

  describe('POST /api/v1/credit-note/complete', () => {
    it('requires authentication', async () => {
      const res = await request(app).post('/api/v1/credit-note/complete').send({});
      expect(res.status).toBe(401);
    });

    it('returns 400 when nota_credito is missing', async () => {
      const res = await request(app).post('/api/v1/credit-note/complete').set('X-API-Key', authHeader).send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(crearNotaCreditoCompletaMock).not.toHaveBeenCalled();
    });

    it('creates a complete credit note and returns its XML', async () => {
      const resultadoMock = {
        nota_credito: { secuencial: '000000001', clave_acceso: '123' },
        detalles: [],
        xml: '<notaCredito/>',
        xml_firmado: null,
        respuesta_sri: null,
      };
      crearNotaCreditoCompletaMock.mockResolvedValueOnce(resultadoMock);

      const res = await request(app)
        .post('/api/v1/credit-note/complete')
        .set('X-API-Key', authHeader)
        .send({ nota_credito: notaCreditoPayload });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.xml).toBe('<notaCredito/>');
      expect(crearNotaCreditoCompletaMock).toHaveBeenCalledWith(notaCreditoPayload, 'company-1');
    });

    it('returns 400 when the body RUC does not match the authenticated tenant', async () => {
      crearNotaCreditoCompletaMock.mockRejectedValueOnce(
        new Error('El RUC del comprobante no coincide con la empresa autenticada'),
      );

      const res = await request(app)
        .post('/api/v1/credit-note/complete')
        .set('X-API-Key', authHeader)
        .send({ nota_credito: notaCreditoPayload });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('no coincide');
    });

    it('returns 400 for validation errors from the service', async () => {
      crearNotaCreditoCompletaMock.mockRejectedValueOnce(new Error('Client not found'));

      const res = await request(app)
        .post('/api/v1/credit-note/complete')
        .set('X-API-Key', authHeader)
        .send({ nota_credito: notaCreditoPayload });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Client not found');
    });

    it('returns 500 for unexpected service errors', async () => {
      crearNotaCreditoCompletaMock.mockRejectedValueOnce(new Error('mongo down'));

      const res = await request(app)
        .post('/api/v1/credit-note/complete')
        .set('X-API-Key', authHeader)
        .send({ nota_credito: notaCreditoPayload });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('CRUD endpoints', () => {
    it('lists only the tenant’s own credit notes', async () => {
      creditNoteStaticMocks.find.mockResolvedValueOnce([{ secuencial: '000000001' }]);

      const res = await request(app).get('/api/v1/credit-note').set('X-API-Key', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(creditNoteStaticMocks.find).toHaveBeenCalledWith({ empresa_emisora_id: 'company-1' });
    });

    it('returns 404 for a missing/cross-tenant credit note', async () => {
      const res = await request(app).get('/api/v1/credit-note/507f1f77bcf86cd799439011').set('X-API-Key', authHeader);

      expect(res.status).toBe(404);
    });

    it('returns a credit note by id scoped to the tenant', async () => {
      creditNoteStaticMocks.findOne.mockResolvedValueOnce({ secuencial: '000000001' });

      const res = await request(app).get('/api/v1/credit-note/507f1f77bcf86cd799439011').set('X-API-Key', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.secuencial).toBe('000000001');
      expect(creditNoteStaticMocks.findOne).toHaveBeenCalledWith({
        _id: '507f1f77bcf86cd799439011',
        empresa_emisora_id: 'company-1',
      });
    });

    it('returns the PDF info of a credit note that belongs to the tenant', async () => {
      creditNoteStaticMocks.findOne.mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011' });
      creditNotePDFStaticMocks.findOne.mockResolvedValueOnce({ pdf_url: 'https://cdn/pdf.pdf', estado: 'GENERADO' });

      const res = await request(app)
        .get('/api/v1/credit-note/507f1f77bcf86cd799439011/pdf')
        .set('X-API-Key', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.pdf_url).toBe('https://cdn/pdf.pdf');
    });

    it('404s the PDF lookup when the credit note belongs to another tenant', async () => {
      const res = await request(app)
        .get('/api/v1/credit-note/507f1f77bcf86cd799439011/pdf')
        .set('X-API-Key', authHeader);

      expect(res.status).toBe(404);
      expect(creditNotePDFStaticMocks.findOne).not.toHaveBeenCalled();
    });

    it('returns 404 when the credit note has no PDF yet', async () => {
      creditNoteStaticMocks.findOne.mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011' });

      const res = await request(app)
        .get('/api/v1/credit-note/507f1f77bcf86cd799439011/pdf')
        .set('X-API-Key', authHeader);

      expect(res.status).toBe(404);
    });

    it('deletes a credit note scoped to the tenant', async () => {
      creditNoteStaticMocks.findOneAndDelete.mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011' });

      const res = await request(app)
        .delete('/api/v1/credit-note/507f1f77bcf86cd799439011')
        .set('X-API-Key', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Deleted');
      expect(creditNoteStaticMocks.findOneAndDelete).toHaveBeenCalledWith({
        _id: '507f1f77bcf86cd799439011',
        empresa_emisora_id: 'company-1',
      });
    });
  });
});
