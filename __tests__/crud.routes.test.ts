import request from 'supertest';

// --- Generic model mock factory ---
function createModelMock(saved: any[]) {
  const statics = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(null),
    findByIdAndUpdate: jest.fn().mockResolvedValue(null),
    findByIdAndDelete: jest.fn().mockResolvedValue(null),
    countDocuments: jest.fn().mockResolvedValue(1),
    saveMock: jest.fn().mockResolvedValue(undefined),
  };
  class MockModel {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      this._id = 'doc-1';
      saved.push(this);
    }
    save = () => statics.saveMock(this);
    static find = (...args: any[]) => statics.find(...args);
    static findOne = (...args: any[]) => statics.findOne(...args);
    static findById = (...args: any[]) => statics.findById(...args);
    static findByIdAndUpdate = (...args: any[]) => statics.findByIdAndUpdate(...args);
    static findByIdAndDelete = (...args: any[]) => statics.findByIdAndDelete(...args);
    static countDocuments = (...args: any[]) => statics.countDocuments(...args);
  }
  return { MockModel, statics };
}

const saved: any[] = [];
const identificationTypeMock = createModelMock(saved);
const clientMock = createModelMock(saved);
const productMock = createModelMock(saved);
const invoiceDetailMock = createModelMock(saved);
const issuingCompanyMock = createModelMock(saved);
const invoiceMock = createModelMock(saved);
const invoicePDFMock = createModelMock(saved);
const creditNoteMock = createModelMock(saved);
const debitNoteMock = createModelMock(saved);
const deliveryNoteMock = createModelMock(saved);
const withholdingMock = createModelMock(saved);
const userMock = createModelMock(saved);

jest.mock('../src/models/IdentificationType', () => ({ __esModule: true, default: identificationTypeMock.MockModel }));
jest.mock('../src/models/Client', () => ({ __esModule: true, default: clientMock.MockModel }));
jest.mock('../src/models/Product', () => ({ __esModule: true, default: productMock.MockModel }));
jest.mock('../src/models/InvoiceDetail', () => ({ __esModule: true, default: invoiceDetailMock.MockModel }));
jest.mock('../src/models/IssuingCompany', () => ({ __esModule: true, default: issuingCompanyMock.MockModel }));
jest.mock('../src/models/Invoice', () => ({ __esModule: true, default: invoiceMock.MockModel }));
jest.mock('../src/models/InvoicePDF', () => ({ __esModule: true, default: invoicePDFMock.MockModel }));
jest.mock('../src/models/CreditNote', () => ({ __esModule: true, default: creditNoteMock.MockModel }));
jest.mock('../src/models/DebitNote', () => ({ __esModule: true, default: debitNoteMock.MockModel }));
jest.mock('../src/models/DeliveryNote', () => ({ __esModule: true, default: deliveryNoteMock.MockModel }));
jest.mock('../src/models/Withholding', () => ({ __esModule: true, default: withholdingMock.MockModel }));
jest.mock('../src/models/User', () => ({ __esModule: true, default: userMock.MockModel }));

// --- ApiKey mock (apiKeyAuth runs on every /api/v1/* request) ---
// findOne returns a chainable, thenable object so `.populate('empresa_emisora_id')`
// works the same way it would on a real Mongoose query — the mock just
// resolves to the pre-shaped "already populated" document below rather than
// simulating real population.
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

const ACTIVE_COMPANY_ID = 'company-1';
// Default: every request presents a valid, non-revoked key for an active
// company. Individual tests can override with mockResolvedValueOnce/mockResolvedValue.
apiKeyStaticMocks.findOne.mockResolvedValue({
  _id: 'api-key-1',
  revoked_at: undefined,
  last_used_at: undefined,
  empresa_emisora_id: { _id: ACTIVE_COMPANY_ID, active: true },
});

jest.mock('../src/models/CreditNotePDF', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null) },
}));
jest.mock('../src/models/DebitNotePDF', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null) },
}));
jest.mock('../src/models/DeliveryNotePDF', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null) },
}));
jest.mock('../src/models/WithholdingPDF', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null) },
}));

// Services are unit-tested separately
jest.mock('../src/services/invoice.service', () => ({ InvoiceService: { crearFacturaCompleta: jest.fn() } }));
jest.mock('../src/services/credit-note.service', () => ({
  CreditNoteService: { crearNotaCreditoCompleta: jest.fn() },
}));
jest.mock('../src/services/debit-note.service', () => ({ DebitNoteService: { crearNotaDebitoCompleta: jest.fn() } }));
jest.mock('../src/services/delivery-note.service', () => ({
  DeliveryNoteService: { crearGuiaRemisionCompleta: jest.fn() },
}));
jest.mock('../src/services/withholding.service', () => ({ WithholdingService: { crearRetencionCompleta: jest.fn() } }));

// Loaded after the mock definitions so the hoisted jest.mock factories
// can reference the model mocks when the routes import them
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createApp } = require('../src/testApp');

const app = createApp();
const API_KEY = 'sk_live_test_token_1234567890';
const authHeader = API_KEY;
const ID = '507f1f77bcf86cd799439011';

describe('apiKeyAuth middleware', () => {
  it('rejects requests without an API key', async () => {
    const res = await request(app).get('/api/v1/client');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('API key requerida');
  });

  it('rejects unknown API keys', async () => {
    apiKeyStaticMocks.findOne.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/v1/client').set('X-API-Key', 'sk_live_no_existe');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('API key inválida');
  });

  it('rejects revoked API keys', async () => {
    apiKeyStaticMocks.findOne.mockResolvedValueOnce({
      _id: 'api-key-1',
      revoked_at: new Date(),
      empresa_emisora_id: { _id: ACTIVE_COMPANY_ID, active: true },
    });
    const res = await request(app).get('/api/v1/client').set('X-API-Key', API_KEY);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('API key inválida');
  });

  it('rejects API keys belonging to a deactivated company', async () => {
    apiKeyStaticMocks.findOne.mockResolvedValueOnce({
      _id: 'api-key-1',
      empresa_emisora_id: { _id: ACTIVE_COMPANY_ID, active: false },
    });
    const res = await request(app).get('/api/v1/client').set('X-API-Key', API_KEY);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('API key inválida');
  });
});

describe.each([
  ['client', clientMock],
  ['product', productMock],
  ['invoice-detail', invoiceDetailMock],
  ['identification-type', identificationTypeMock],
])('CRUD /api/v1/%s', (ruta, mock) => {
  beforeEach(() => {
    jest.clearAllMocks();
    saved.length = 0;
  });

  it('creates a document', async () => {
    const res = await request(app).post(`/api/v1/${ruta}`).set('X-API-Key', authHeader).send({ campo: 'valor' });

    expect(res.status).toBe(201);
    expect(saved).toHaveLength(1);
  });

  it('lists documents', async () => {
    mock.statics.find.mockResolvedValueOnce([{ _id: ID }]);

    const res = await request(app).get(`/api/v1/${ruta}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('returns 404 for a missing document and 200 when found', async () => {
    let res = await request(app).get(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);

    mock.statics.findById.mockResolvedValueOnce({ _id: ID });
    res = await request(app).get(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);
  });

  it('updates and deletes documents', async () => {
    mock.statics.findByIdAndUpdate.mockResolvedValueOnce({ _id: ID, actualizado: true });
    let res = await request(app).put(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader).send({ a: 1 });
    expect(res.status).toBe(200);

    mock.statics.findByIdAndDelete.mockResolvedValueOnce({ _id: ID });
    res = await request(app).delete(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);

    // 404 branches
    res = await request(app).put(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader).send({});
    expect(res.status).toBe(404);
    res = await request(app).delete(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);
  });

  it('returns 500 when the database fails', async () => {
    mock.statics.find.mockRejectedValueOnce(new Error('mongo down'));

    const res = await request(app).get(`/api/v1/${ruta}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(500);
  });
});

describe.each([
  ['credit-note', creditNoteMock],
  ['debit-note', debitNoteMock],
  ['delivery-note', deliveryNoteMock],
  ['withholding', withholdingMock],
  ['invoice', invoiceMock],
])('Raw CRUD of /api/v1/%s', (ruta, mock) => {
  beforeEach(() => {
    jest.clearAllMocks();
    saved.length = 0;
  });

  it('creates a raw document with POST /', async () => {
    const res = await request(app).post(`/api/v1/${ruta}`).set('X-API-Key', authHeader).send({ campo: 'valor' });

    expect(res.status).toBe(201);
    expect(saved).toHaveLength(1);
  });

  it('updates a document with PUT /:id', async () => {
    mock.statics.findByIdAndUpdate.mockResolvedValueOnce({ _id: ID });

    const res = await request(app).put(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader).send({ a: 1 });

    expect(res.status).toBe(200);
  });

  it('gets a document by id and handles the 404 case', async () => {
    mock.statics.findById.mockResolvedValueOnce({ _id: ID });
    let res = await request(app).get(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);

    res = await request(app).get(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);
  });

  it('deletes a document and handles the 404 case', async () => {
    mock.statics.findByIdAndDelete.mockResolvedValueOnce({ _id: ID });
    let res = await request(app).delete(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);

    res = await request(app).delete(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);
  });

  it('returns 500 when the database fails on list', async () => {
    mock.statics.find.mockRejectedValueOnce(new Error('mongo down'));

    const res = await request(app).get(`/api/v1/${ruta}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(500);
  });
});

describe('IssuingCompany routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    saved.length = 0;
  });

  it('lists, gets, updates and deletes companies', async () => {
    issuingCompanyMock.statics.find.mockResolvedValueOnce([{ _id: ID }]);
    let res = await request(app).get('/api/v1/issuing-company').set('X-API-Key', authHeader);
    expect(res.status).toBe(200);

    issuingCompanyMock.statics.findById.mockResolvedValueOnce({ _id: ID });
    res = await request(app).get(`/api/v1/issuing-company/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);

    res = await request(app).get(`/api/v1/issuing-company/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);

    issuingCompanyMock.statics.findByIdAndUpdate.mockResolvedValueOnce({ _id: ID });
    res = await request(app).put(`/api/v1/issuing-company/${ID}`).set('X-API-Key', authHeader).send({ a: 1 });
    expect(res.status).toBe(200);

    issuingCompanyMock.statics.findByIdAndDelete.mockResolvedValueOnce({ _id: ID });
    res = await request(app).delete(`/api/v1/issuing-company/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);
  });

  it('encrypts the certificate and password at rest on update', async () => {
    issuingCompanyMock.statics.findByIdAndUpdate.mockResolvedValueOnce({ _id: ID });

    const res = await request(app)
      .put(`/api/v1/issuing-company/${ID}`)
      .set('X-API-Key', authHeader)
      .send({
        certificate: 'cGxhaW4tcDEyLWJhc2U2NA==',
        certificate_password: 'test-new-cert-password',
        razon_social: 'X',
      });

    expect(res.status).toBe(200);
    const [, updateData] = issuingCompanyMock.statics.findByIdAndUpdate.mock.calls[0];
    expect(updateData.certificate).toBeDefined();
    expect(updateData.certificate).not.toBe('cGxhaW4tcDEyLWJhc2U2NA=='); // stored encrypted
    expect(updateData.certificate_password).toBeDefined();
    expect(updateData.certificate_password).not.toBe('test-new-cert-password'); // stored encrypted
  });

  it('ignores a certificatePath field and never reads from the filesystem (fixes the arbitrary file-read bug)', async () => {
    const fs = require('fs');
    const readSpy = jest.spyOn(fs, 'readFileSync');
    issuingCompanyMock.statics.findByIdAndUpdate.mockResolvedValueOnce({ _id: ID });

    const res = await request(app)
      .put(`/api/v1/issuing-company/${ID}`)
      .set('X-API-Key', authHeader)
      .send({ certificatePath: '/etc/passwd', razon_social: 'X' });

    expect(res.status).toBe(200);
    expect(readSpy).not.toHaveBeenCalled();
    const [, updateData] = issuingCompanyMock.statics.findByIdAndUpdate.mock.calls[0];
    expect(updateData.certificatePath).toBeUndefined();
    expect(updateData.certificate).toBeUndefined();
    readSpy.mockRestore();
  });

  it('returns 404 when updating or deleting a missing company', async () => {
    let res = await request(app).put(`/api/v1/issuing-company/${ID}`).set('X-API-Key', authHeader).send({ a: 1 });
    expect(res.status).toBe(404);

    res = await request(app).delete(`/api/v1/issuing-company/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);
  });

  it('returns 500 on database failures for every endpoint', async () => {
    issuingCompanyMock.statics.find.mockRejectedValueOnce(new Error('mongo down'));
    let res = await request(app).get('/api/v1/issuing-company').set('X-API-Key', authHeader);
    expect(res.status).toBe(500);

    issuingCompanyMock.statics.findById.mockRejectedValueOnce(new Error('mongo down'));
    res = await request(app).get(`/api/v1/issuing-company/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(500);

    issuingCompanyMock.statics.findByIdAndUpdate.mockRejectedValueOnce(new Error('mongo down'));
    res = await request(app).put(`/api/v1/issuing-company/${ID}`).set('X-API-Key', authHeader).send({ a: 1 });
    expect(res.status).toBe(500);

    issuingCompanyMock.statics.findByIdAndDelete.mockRejectedValueOnce(new Error('mongo down'));
    res = await request(app).delete(`/api/v1/issuing-company/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(500);
  });
});

describe('Invoice route error branches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    saved.length = 0;
  });

  it('returns 400 when factura is missing on /complete', async () => {
    const res = await request(app).post('/api/v1/invoice/complete').set('X-API-Key', authHeader).send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 when the complete-invoice service fails unexpectedly', async () => {
    const { InvoiceService } = require('../src/services/invoice.service');
    InvoiceService.crearFacturaCompleta.mockRejectedValueOnce(new Error('mongo down'));

    const res = await request(app)
      .post('/api/v1/invoice/complete')
      .set('X-API-Key', authHeader)
      .send({ factura: { infoTributaria: {} } });

    expect(res.status).toBe(500);
  });

  it('returns 400 for validation errors from the complete-invoice service', async () => {
    const { InvoiceService } = require('../src/services/invoice.service');
    InvoiceService.crearFacturaCompleta.mockRejectedValueOnce(new Error('Client not found'));

    const res = await request(app)
      .post('/api/v1/invoice/complete')
      .set('X-API-Key', authHeader)
      .send({ factura: { infoTributaria: {} } });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Client not found');
  });

  it('returns 500 on database failures for every CRUD endpoint', async () => {
    invoiceMock.statics.findById.mockRejectedValueOnce(new Error('mongo down'));
    let res = await request(app).get(`/api/v1/invoice/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(500);

    invoiceMock.statics.findByIdAndUpdate.mockRejectedValueOnce(new Error('mongo down'));
    res = await request(app).put(`/api/v1/invoice/${ID}`).set('X-API-Key', authHeader).send({ a: 1 });
    expect(res.status).toBe(500);

    invoiceMock.statics.findByIdAndDelete.mockRejectedValueOnce(new Error('mongo down'));
    res = await request(app).delete(`/api/v1/invoice/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(500);
  });

  it('returns 500 when the raw POST save fails', async () => {
    invoiceMock.statics.saveMock.mockRejectedValueOnce(new Error('mongo down'));

    const res = await request(app).post('/api/v1/invoice').set('X-API-Key', authHeader).send({ campo: 'valor' });

    expect(res.status).toBe(500);
  });

  it('gets and deletes invoices including the 404 branches', async () => {
    invoiceMock.statics.findById.mockResolvedValueOnce({ _id: ID });
    let res = await request(app).get(`/api/v1/invoice/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);

    res = await request(app).get(`/api/v1/invoice/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);

    invoiceMock.statics.findByIdAndDelete.mockResolvedValueOnce({ _id: ID });
    res = await request(app).delete(`/api/v1/invoice/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);

    res = await request(app).delete(`/api/v1/invoice/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);
  });
});

describe('InvoicePDF routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    saved.length = 0;
  });

  const CLAVE = '1705202501179001234500110010010000000011234567810';

  it('lists PDFs with populated invoices', async () => {
    invoicePDFMock.statics.find.mockReturnValueOnce({ populate: jest.fn().mockResolvedValue([{ _id: ID }]) } as any);

    const res = await request(app).get('/api/v1/invoice-pdf').set('X-API-Key', authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('finds a PDF by invoice id and by access key', async () => {
    invoicePDFMock.statics.findOne.mockResolvedValueOnce({ _id: ID });
    let res = await request(app).get(`/api/v1/invoice-pdf/invoice/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);

    res = await request(app).get(`/api/v1/invoice-pdf/invoice/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);

    invoicePDFMock.statics.findOne.mockResolvedValueOnce({ _id: ID, claveAcceso: CLAVE });
    res = await request(app).get(`/api/v1/invoice-pdf/access-key/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);
  });

  it('redirects to the public PDF URL on download', async () => {
    invoicePDFMock.statics.findOne.mockResolvedValueOnce({ pdf_url: 'https://cdn/f.pdf' });

    const res = await request(app).get(`/api/v1/invoice-pdf/download/${CLAVE}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://cdn/f.pdf');
  });

  it('returns 404 on download when the PDF has no URL', async () => {
    invoicePDFMock.statics.findOne.mockResolvedValueOnce({ pdf_url: '' });

    const res = await request(app).get(`/api/v1/invoice-pdf/download/${CLAVE}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(404);
  });

  it('queues an email send and reports email status', async () => {
    const doc: any = { email_estado: 'NO_ENVIADO', save: jest.fn().mockResolvedValue({}) };
    invoicePDFMock.statics.findOne.mockResolvedValueOnce(doc);
    let res = await request(app)
      .post(`/api/v1/invoice-pdf/send-email/${CLAVE}`)
      .set('X-API-Key', authHeader)
      .send({ email_destinatario: 'cliente@test.com' });
    expect(res.status).toBe(200);
    expect(doc.email_estado).toBe('PENDIENTE');

    res = await request(app).post(`/api/v1/invoice-pdf/send-email/${CLAVE}`).set('X-API-Key', authHeader).send({});
    expect(res.status).toBe(400);

    invoicePDFMock.statics.findOne.mockResolvedValueOnce({ email_estado: 'PENDIENTE', email_intentos: 1 });
    res = await request(app).get(`/api/v1/invoice-pdf/email-status/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.email_estado).toBe('PENDIENTE');
  });

  it('handles email retries and the already-sent case', async () => {
    const doc: any = { email_estado: 'ERROR', save: jest.fn().mockResolvedValue({}) };
    invoicePDFMock.statics.findOne.mockResolvedValueOnce(doc);
    let res = await request(app).post(`/api/v1/invoice-pdf/retry-email/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);
    expect(doc.email_estado).toBe('PENDIENTE');

    invoicePDFMock.statics.findOne.mockResolvedValueOnce({ email_estado: 'ENVIADO' });
    res = await request(app).post(`/api/v1/invoice-pdf/retry-email/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(400);
  });

  it('returns 500 on database failures for every endpoint', async () => {
    invoicePDFMock.statics.find.mockReturnValueOnce({
      populate: jest.fn().mockRejectedValue(new Error('mongo down')),
    } as any);
    let res = await request(app).get('/api/v1/invoice-pdf').set('X-API-Key', authHeader);
    expect(res.status).toBe(500);

    invoicePDFMock.statics.findOne.mockRejectedValueOnce(new Error('mongo down'));
    res = await request(app).get(`/api/v1/invoice-pdf/invoice/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(500);

    invoicePDFMock.statics.findOne.mockRejectedValueOnce(new Error('mongo down'));
    res = await request(app).get(`/api/v1/invoice-pdf/access-key/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(500);

    invoicePDFMock.statics.findOne.mockRejectedValueOnce(new Error('mongo down'));
    res = await request(app).get(`/api/v1/invoice-pdf/download/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(500);

    invoicePDFMock.statics.findOne.mockRejectedValueOnce(new Error('mongo down'));
    res = await request(app)
      .post(`/api/v1/invoice-pdf/send-email/${CLAVE}`)
      .set('X-API-Key', authHeader)
      .send({ email_destinatario: 'cliente@test.com' });
    expect(res.status).toBe(500);

    invoicePDFMock.statics.findOne.mockRejectedValueOnce(new Error('mongo down'));
    res = await request(app).get(`/api/v1/invoice-pdf/email-status/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(500);

    invoicePDFMock.statics.findOne.mockRejectedValueOnce(new Error('mongo down'));
    res = await request(app).post(`/api/v1/invoice-pdf/retry-email/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(500);
  });

  it('returns 404 when the PDF does not exist on the secondary endpoints', async () => {
    let res = await request(app).get(`/api/v1/invoice-pdf/access-key/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);

    res = await request(app).get(`/api/v1/invoice-pdf/download/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);

    res = await request(app)
      .post(`/api/v1/invoice-pdf/send-email/${CLAVE}`)
      .set('X-API-Key', authHeader)
      .send({ email_destinatario: 'cliente@test.com' });
    expect(res.status).toBe(404);

    res = await request(app).get(`/api/v1/invoice-pdf/email-status/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);

    res = await request(app).post(`/api/v1/invoice-pdf/retry-email/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);
  });

  it('acknowledges PDF regeneration requests', async () => {
    const res = await request(app).post(`/api/v1/invoice-pdf/regenerate/${ID}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.facturaId).toBe(ID);
  });
});
