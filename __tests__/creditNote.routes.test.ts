import request from 'supertest';
import { createApp } from '../src/testApp';

// --- Model mocks ---
const creditNoteInstanceMocks = {
  save: jest.fn().mockResolvedValue({}),
};

const creditNoteStaticMocks = {
  find: jest.fn().mockResolvedValue([]),
  findById: jest.fn().mockResolvedValue(null),
  findOne: jest.fn().mockResolvedValue(null),
  findByIdAndUpdate: jest.fn().mockResolvedValue(null),
  findByIdAndDelete: jest.fn().mockResolvedValue(null),
};

jest.mock('../src/models/CreditNote', () => {
  class MockCreditNote {
    constructor(public data: any) {}
    save = creditNoteInstanceMocks.save;
    static find = (...args: any[]) => creditNoteStaticMocks.find(...args);
    static findById = (...args: any[]) => creditNoteStaticMocks.findById(...args);
    static findOne = (...args: any[]) => creditNoteStaticMocks.findOne(...args);
    static findByIdAndUpdate = (...args: any[]) => creditNoteStaticMocks.findByIdAndUpdate(...args);
    static findByIdAndDelete = (...args: any[]) => creditNoteStaticMocks.findByIdAndDelete(...args);
  }
  return { __esModule: true, default: MockCreditNote };
});

const creditNotePDFStaticMocks = {
  findOne: jest.fn().mockResolvedValue(null),
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
  findByIdAndUpdate: jest.fn().mockResolvedValue(null),
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
apiKeyStaticMocks.findOne.mockResolvedValue({
  _id: 'api-key-1',
  revoked_at: undefined,
  last_used_at: undefined,
  empresa_emisora_id: { _id: 'company-1', active: true },
});

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
    jest.clearAllMocks();
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
      expect(crearNotaCreditoCompletaMock).toHaveBeenCalledWith(notaCreditoPayload);
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
    it('lists credit notes', async () => {
      creditNoteStaticMocks.find.mockResolvedValueOnce([{ secuencial: '000000001' }]);

      const res = await request(app).get('/api/v1/credit-note').set('X-API-Key', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('returns 404 for a missing credit note', async () => {
      const res = await request(app).get('/api/v1/credit-note/507f1f77bcf86cd799439011').set('X-API-Key', authHeader);

      expect(res.status).toBe(404);
    });

    it('returns a credit note by id', async () => {
      creditNoteStaticMocks.findById.mockResolvedValueOnce({ secuencial: '000000001' });

      const res = await request(app).get('/api/v1/credit-note/507f1f77bcf86cd799439011').set('X-API-Key', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.secuencial).toBe('000000001');
    });

    it('returns the PDF info of a credit note', async () => {
      creditNotePDFStaticMocks.findOne.mockResolvedValueOnce({ pdf_url: 'https://cdn/pdf.pdf', estado: 'GENERADO' });

      const res = await request(app)
        .get('/api/v1/credit-note/507f1f77bcf86cd799439011/pdf')
        .set('X-API-Key', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.pdf_url).toBe('https://cdn/pdf.pdf');
    });

    it('returns 404 when the credit note has no PDF yet', async () => {
      const res = await request(app)
        .get('/api/v1/credit-note/507f1f77bcf86cd799439011/pdf')
        .set('X-API-Key', authHeader);

      expect(res.status).toBe(404);
    });

    it('deletes a credit note', async () => {
      creditNoteStaticMocks.findByIdAndDelete.mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011' });

      const res = await request(app)
        .delete('/api/v1/credit-note/507f1f77bcf86cd799439011')
        .set('X-API-Key', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Deleted');
    });
  });
});
