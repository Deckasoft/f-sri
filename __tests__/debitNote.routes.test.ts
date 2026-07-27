import request from 'supertest';
import { createApp } from '../src/testApp';

// --- Model mocks ---
// Behavior is NOT configured here: every default lives in seedMockDefaults()
// below, which beforeEach re-applies after jest.resetAllMocks(). See the
// comment on beforeEach for why the reset has to be resetAllMocks and not
// clearAllMocks.
const debitNoteInstanceMocks = {
  save: jest.fn(),
};

const debitNoteStaticMocks = {
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findOneAndDelete: jest.fn(),
};

const savedDebitNotes: any[] = [];
jest.mock('../src/models/DebitNote', () => {
  class MockDebitNote {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      this._id = 'nd-1';
      savedDebitNotes.push(this);
    }
    save = debitNoteInstanceMocks.save;
    static find = (...args: any[]) => debitNoteStaticMocks.find(...args);
    static findById = (...args: any[]) => debitNoteStaticMocks.findById(...args);
    static findOne = (...args: any[]) => debitNoteStaticMocks.findOne(...args);
    static findByIdAndUpdate = (...args: any[]) => debitNoteStaticMocks.findByIdAndUpdate(...args);
    static findByIdAndDelete = (...args: any[]) => debitNoteStaticMocks.findByIdAndDelete(...args);
    static findOneAndUpdate = (...args: any[]) => debitNoteStaticMocks.findOneAndUpdate(...args);
    static findOneAndDelete = (...args: any[]) => debitNoteStaticMocks.findOneAndDelete(...args);
  }
  return { __esModule: true, default: MockDebitNote };
});

const debitNotePDFStaticMocks = {
  findOne: jest.fn(),
};

jest.mock('../src/models/DebitNotePDF', () => ({
  __esModule: true,
  default: {
    findOne: (...args: any[]) => debitNotePDFStaticMocks.findOne(...args),
  },
}));

// --- Service mock ---
const crearNotaDebitoCompletaMock = jest.fn();
jest.mock('../src/services/debit-note.service', () => ({
  DebitNoteService: {
    crearNotaDebitoCompleta: (...args: any[]) => crearNotaDebitoCompletaMock(...args),
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
  debitNoteInstanceMocks.save.mockResolvedValue({});
  debitNoteStaticMocks.find.mockResolvedValue([]);
  debitNoteStaticMocks.findById.mockResolvedValue(null);
  debitNoteStaticMocks.findOne.mockResolvedValue(null);
  debitNoteStaticMocks.findByIdAndUpdate.mockResolvedValue(null);
  debitNoteStaticMocks.findByIdAndDelete.mockResolvedValue(null);
  debitNoteStaticMocks.findOneAndUpdate.mockResolvedValue(null);
  debitNoteStaticMocks.findOneAndDelete.mockResolvedValue(null);
  debitNotePDFStaticMocks.findOne.mockResolvedValue(null);
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

const notaDebitoPayload = {
  infoTributaria: { ruc: '1790012345001' },
  infoNotaDebito: {
    fechaEmision: '17/05/2025',
    tipoIdentificacionComprador: '05',
    identificacionComprador: '0106079783',
    codDocModificado: '01',
    numDocModificado: '001-001-000000123',
    fechaEmisionDocSustento: '10/05/2025',
    totalSinImpuestos: '50.00',
    impuestos: [],
    valorTotal: '57.50',
    pagos: [],
  },
  motivos: [],
};

describe('Debit note routes', () => {
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

  describe('POST /api/v1/debit-note/complete', () => {
    it('requires authentication', async () => {
      const res = await request(app).post('/api/v1/debit-note/complete').send({});
      expect(res.status).toBe(401);
    });

    it('returns 400 when nota_debito is missing', async () => {
      const res = await request(app).post('/api/v1/debit-note/complete').set('X-API-Key', authHeader).send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(crearNotaDebitoCompletaMock).not.toHaveBeenCalled();
    });

    it('creates a complete debit note and returns its XML', async () => {
      const resultadoMock = {
        nota_debito: { secuencial: '000000001', clave_acceso: '123' },
        xml: '<notaDebito/>',
        xml_firmado: null,
        respuesta_sri: null,
      };
      crearNotaDebitoCompletaMock.mockResolvedValueOnce(resultadoMock);

      const res = await request(app)
        .post('/api/v1/debit-note/complete')
        .set('X-API-Key', authHeader)
        .send({ nota_debito: notaDebitoPayload });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.xml).toBe('<notaDebito/>');
      expect(crearNotaDebitoCompletaMock).toHaveBeenCalledWith(notaDebitoPayload, 'company-1');
    });

    it('returns 400 when the body RUC does not match the authenticated tenant', async () => {
      crearNotaDebitoCompletaMock.mockRejectedValueOnce(
        new Error('El RUC del comprobante no coincide con la empresa autenticada'),
      );

      const res = await request(app)
        .post('/api/v1/debit-note/complete')
        .set('X-API-Key', authHeader)
        .send({ nota_debito: notaDebitoPayload });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('no coincide');
    });

    it('returns 400 for validation errors from the service', async () => {
      crearNotaDebitoCompletaMock.mockRejectedValueOnce(new Error('Datos de nota de débito inválidos o incompletos'));

      const res = await request(app)
        .post('/api/v1/debit-note/complete')
        .set('X-API-Key', authHeader)
        .send({ nota_debito: notaDebitoPayload });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('inválidos');
    });

    it('returns 500 for unexpected service errors', async () => {
      crearNotaDebitoCompletaMock.mockRejectedValueOnce(new Error('mongo down'));

      const res = await request(app)
        .post('/api/v1/debit-note/complete')
        .set('X-API-Key', authHeader)
        .send({ nota_debito: notaDebitoPayload });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('CRUD endpoints', () => {
    it('lists only the tenant’s own debit notes', async () => {
      debitNoteStaticMocks.find.mockResolvedValueOnce([{ secuencial: '000000001' }]);

      const res = await request(app).get('/api/v1/debit-note').set('X-API-Key', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(debitNoteStaticMocks.find).toHaveBeenCalledWith({ empresa_emisora_id: 'company-1' });
    });

    it('returns 404 for a missing/cross-tenant debit note', async () => {
      const res = await request(app).get('/api/v1/debit-note/507f1f77bcf86cd799439011').set('X-API-Key', authHeader);

      expect(res.status).toBe(404);
    });

    it('returns a debit note by id scoped to the tenant', async () => {
      debitNoteStaticMocks.findOne.mockResolvedValueOnce({ secuencial: '000000001' });

      const res = await request(app).get('/api/v1/debit-note/507f1f77bcf86cd799439011').set('X-API-Key', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.secuencial).toBe('000000001');
    });

    it('returns the PDF info of a debit note that belongs to the tenant', async () => {
      debitNoteStaticMocks.findOne.mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011' });
      debitNotePDFStaticMocks.findOne.mockResolvedValueOnce({ pdf_url: 'https://cdn/pdf.pdf', estado: 'GENERADO' });

      const res = await request(app)
        .get('/api/v1/debit-note/507f1f77bcf86cd799439011/pdf')
        .set('X-API-Key', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.pdf_url).toBe('https://cdn/pdf.pdf');
    });

    it('404s the PDF lookup when the debit note belongs to another tenant', async () => {
      const res = await request(app)
        .get('/api/v1/debit-note/507f1f77bcf86cd799439011/pdf')
        .set('X-API-Key', authHeader);

      expect(res.status).toBe(404);
      expect(debitNotePDFStaticMocks.findOne).not.toHaveBeenCalled();
    });

    it('deletes a debit note scoped to the tenant', async () => {
      debitNoteStaticMocks.findOneAndDelete.mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011' });

      const res = await request(app).delete('/api/v1/debit-note/507f1f77bcf86cd799439011').set('X-API-Key', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Deleted');
      expect(debitNoteStaticMocks.findOneAndDelete).toHaveBeenCalledWith({
        _id: '507f1f77bcf86cd799439011',
        empresa_emisora_id: 'company-1',
      });
    });
  });
});
