import request from 'supertest';

// PUT /api/v1/issuing-company/certificate verifies the incoming P12 opens
// with the given password before storing anything. The real P12 parsing
// (node-forge) is exercised in certificate.utils.test.ts; here we only need
// to control valid/invalid outcomes.
const verifyP12PasswordMock = jest.fn().mockResolvedValue({ valid: true });
jest.mock('../src/utils/certificate.utils', () => ({
  verifyP12Password: (...args: any[]) => verifyP12PasswordMock(...args),
}));

// A default find() result must support both direct awaiting (`await
// Model.find(filter)` — most CRUD list endpoints) and chaining
// `.distinct()`/`.populate()` (invoiceDetail.ts / invoicePDF.ts, which
// resolve the tenant's own Invoice ids before touching the child
// collection). Building it this way means unmocked calls "just work" for
// either call shape, and tests can still override with mockResolvedValueOnce
// (plain array) or mockReturnValueOnce(queryReturning(...)) (chainable) as
// needed.
function queryReturning(value: any) {
  const query: any = Promise.resolve(value);
  query.distinct = jest.fn().mockResolvedValue(Array.isArray(value) ? value.map((v: any) => v._id ?? v) : []);
  query.populate = jest.fn().mockResolvedValue(value);
  return query;
}

// --- Generic model mock factory ---
function createModelMock(saved: any[]) {
  const statics = {
    find: jest.fn((..._args: any[]) => queryReturning([])),
    findOne: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(null),
    findByIdAndUpdate: jest.fn().mockResolvedValue(null),
    findByIdAndDelete: jest.fn().mockResolvedValue(null),
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
    findOneAndDelete: jest.fn().mockResolvedValue(null),
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
    static findOneAndUpdate = (...args: any[]) => statics.findOneAndUpdate(...args);
    static findOneAndDelete = (...args: any[]) => statics.findOneAndDelete(...args);
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

// invoicePDF.ts's download endpoint resolves a fresh download URL from the
// configured storage provider (presigned for S3) instead of redirecting to a
// stored static URL — mocked here so the route test doesn't depend on a real
// provider/AWS SDK.
const storageMock = {
  getDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/presigned-url'),
  getFileBuffer: jest.fn(),
  getProviderName: jest.fn().mockReturnValue('local'),
};
jest.mock('../src/services/storage', () => ({
  __esModule: true,
  PDFStorageFactory: { create: () => storageMock },
}));

// Email sending itself (Resend + attachment fetching) is unit-tested in
// email.utils.test.ts — here we only verify the route wires the result into
// email_estado/email_intentos/email_ultimo_error correctly.
const sendInvoiceEmailMock = jest.fn();
jest.mock('../src/utils/email.utils', () => ({
  __esModule: true,
  sendInvoiceEmail: (...args: any[]) => sendInvoiceEmailMock(...args),
}));

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

// Client, Product, and the raw CRUD surface of Invoice/CreditNote/DebitNote/
// DeliveryNote/Withholding all follow the exact same tenant-scoped shape:
// POST forces empresa_emisora_id from the authenticated tenant; GET/PUT/DELETE
// by id use findOne/findOneAndUpdate/findOneAndDelete scoped to
// { _id, empresa_emisora_id }, 404ing (never leaking existence) for another
// tenant's record.
describe.each([
  ['client', clientMock],
  ['product', productMock],
  ['invoice', invoiceMock],
  ['credit-note', creditNoteMock],
  ['debit-note', debitNoteMock],
  ['delivery-note', deliveryNoteMock],
  ['withholding', withholdingMock],
])('Tenant-scoped CRUD /api/v1/%s', (ruta, mock) => {
  beforeEach(() => {
    jest.clearAllMocks();
    saved.length = 0;
  });

  it('creates a document scoped to the authenticated tenant, ignoring a spoofed empresa_emisora_id', async () => {
    const res = await request(app)
      .post(`/api/v1/${ruta}`)
      .set('X-API-Key', authHeader)
      .send({ campo: 'valor', empresa_emisora_id: 'someone-elses-company' });

    expect(res.status).toBe(201);
    expect(saved).toHaveLength(1);
    expect(saved[0].empresa_emisora_id).toBe(ACTIVE_COMPANY_ID);
  });

  it('lists only the tenant’s own documents', async () => {
    mock.statics.find.mockResolvedValueOnce([{ _id: ID }]);

    const res = await request(app).get(`/api/v1/${ruta}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(mock.statics.find).toHaveBeenCalledWith({ empresa_emisora_id: ACTIVE_COMPANY_ID });
  });

  it('returns 404 for a missing/cross-tenant document and 200 when it belongs to the tenant', async () => {
    let res = await request(app).get(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);

    mock.statics.findOne.mockResolvedValueOnce({ _id: ID });
    res = await request(app).get(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);
    expect(mock.statics.findOne).toHaveBeenCalledWith({ _id: ID, empresa_emisora_id: ACTIVE_COMPANY_ID });
  });

  it('updates and deletes documents scoped to the tenant, 404ing for another tenant’s record', async () => {
    mock.statics.findOneAndUpdate.mockResolvedValueOnce({ _id: ID, actualizado: true });
    let res = await request(app).put(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader).send({ a: 1 });
    expect(res.status).toBe(200);
    expect(mock.statics.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: ID, empresa_emisora_id: ACTIVE_COMPANY_ID },
      { a: 1 },
      { new: true },
    );

    mock.statics.findOneAndDelete.mockResolvedValueOnce({ _id: ID });
    res = await request(app).delete(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);
    expect(mock.statics.findOneAndDelete).toHaveBeenCalledWith({ _id: ID, empresa_emisora_id: ACTIVE_COMPANY_ID });

    // 404 branches (cross-tenant or missing)
    res = await request(app).put(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader).send({});
    expect(res.status).toBe(404);
    res = await request(app).delete(`/api/v1/${ruta}/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);
  });

  it('strips a spoofed empresa_emisora_id out of the PUT body before updating', async () => {
    mock.statics.findOneAndUpdate.mockResolvedValueOnce({ _id: ID });

    await request(app)
      .put(`/api/v1/${ruta}/${ID}`)
      .set('X-API-Key', authHeader)
      .send({ a: 1, empresa_emisora_id: 'someone-elses-company' });

    const [, updateData] = mock.statics.findOneAndUpdate.mock.calls[0];
    expect(updateData).toEqual({ a: 1 });
  });

  it('returns 500 when the database fails', async () => {
    mock.statics.find.mockRejectedValueOnce(new Error('mongo down'));

    const res = await request(app).get(`/api/v1/${ruta}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(500);
  });
});

describe('IdentificationType routes (global read-only catalog)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    saved.length = 0;
  });

  it('lists the catalog unscoped', async () => {
    identificationTypeMock.statics.find.mockResolvedValueOnce([{ _id: ID }]);

    const res = await request(app).get('/api/v1/identification-type').set('X-API-Key', authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('returns 404 for a missing entry and 200 when found', async () => {
    let res = await request(app).get(`/api/v1/identification-type/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);

    identificationTypeMock.statics.findById.mockResolvedValueOnce({ _id: ID });
    res = await request(app).get(`/api/v1/identification-type/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);
  });

  it('no longer exposes mutation endpoints', async () => {
    let res = await request(app).post('/api/v1/identification-type').set('X-API-Key', authHeader).send({ a: 1 });
    expect(res.status).toBe(404);

    res = await request(app).put(`/api/v1/identification-type/${ID}`).set('X-API-Key', authHeader).send({ a: 1 });
    expect(res.status).toBe(404);

    res = await request(app).delete(`/api/v1/identification-type/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);

    expect(saved).toHaveLength(0);
  });

  it('returns 500 when the database fails', async () => {
    identificationTypeMock.statics.find.mockRejectedValueOnce(new Error('mongo down'));

    const res = await request(app).get('/api/v1/identification-type').set('X-API-Key', authHeader);

    expect(res.status).toBe(500);
  });
});

describe('InvoiceDetail routes (scoped via parent Invoice lookup)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    saved.length = 0;
  });

  it('creates a detail when the referenced invoice belongs to the tenant', async () => {
    invoiceMock.statics.findOne.mockResolvedValueOnce({ _id: 'factura-1' });

    const res = await request(app)
      .post('/api/v1/invoice-detail')
      .set('X-API-Key', authHeader)
      .send({ factura_id: 'factura-1' });

    expect(res.status).toBe(201);
    expect(invoiceMock.statics.findOne).toHaveBeenCalledWith({
      _id: 'factura-1',
      empresa_emisora_id: ACTIVE_COMPANY_ID,
    });
  });

  it('404s creating a detail for an invoice belonging to another tenant', async () => {
    const res = await request(app)
      .post('/api/v1/invoice-detail')
      .set('X-API-Key', authHeader)
      .send({ factura_id: 'someone-elses-invoice' });

    expect(res.status).toBe(404);
    expect(saved).toHaveLength(0);
  });

  it('lists only details belonging to the tenant’s own invoices', async () => {
    invoiceMock.statics.find.mockReturnValueOnce(queryReturning([{ _id: 'factura-1' }]));
    invoiceDetailMock.statics.find.mockResolvedValueOnce([{ _id: ID, factura_id: 'factura-1' }]);

    const res = await request(app).get('/api/v1/invoice-detail').set('X-API-Key', authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(invoiceDetailMock.statics.find).toHaveBeenCalledWith({ factura_id: { $in: ['factura-1'] } });
  });

  it('404s GET /:id when the detail does not exist', async () => {
    const res = await request(app).get(`/api/v1/invoice-detail/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);
  });

  it('404s GET /:id when the detail’s invoice belongs to another tenant', async () => {
    invoiceDetailMock.statics.findById.mockResolvedValueOnce({ _id: ID, factura_id: 'factura-1' });

    const res = await request(app).get(`/api/v1/invoice-detail/${ID}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(404);
  });

  it('200s GET /:id when the detail’s invoice belongs to the tenant', async () => {
    invoiceDetailMock.statics.findById.mockResolvedValueOnce({ _id: ID, factura_id: 'factura-1' });
    invoiceMock.statics.findOne.mockResolvedValueOnce({ _id: 'factura-1' });

    const res = await request(app).get(`/api/v1/invoice-detail/${ID}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(200);
  });

  it('updates and deletes a detail only when its invoice belongs to the tenant', async () => {
    invoiceDetailMock.statics.findById.mockResolvedValueOnce({ _id: ID, factura_id: 'factura-1' });
    invoiceMock.statics.findOne.mockResolvedValueOnce({ _id: 'factura-1' });
    invoiceDetailMock.statics.findByIdAndUpdate.mockResolvedValueOnce({ _id: ID, actualizado: true });

    let res = await request(app).put(`/api/v1/invoice-detail/${ID}`).set('X-API-Key', authHeader).send({ a: 1 });
    expect(res.status).toBe(200);

    invoiceDetailMock.statics.findById.mockResolvedValueOnce({ _id: ID, factura_id: 'factura-1' });
    invoiceMock.statics.findOne.mockResolvedValueOnce({ _id: 'factura-1' });
    invoiceDetailMock.statics.findByIdAndDelete.mockResolvedValueOnce({ _id: ID });

    res = await request(app).delete(`/api/v1/invoice-detail/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);

    // 404 branch: detail exists but belongs to another tenant's invoice
    invoiceDetailMock.statics.findById.mockResolvedValueOnce({ _id: ID, factura_id: 'someone-elses-invoice' });
    res = await request(app).put(`/api/v1/invoice-detail/${ID}`).set('X-API-Key', authHeader).send({});
    expect(res.status).toBe(404);
  });

  // factura_id is this model's tenant-linking field (InvoiceDetail carries no
  // empresa_emisora_id of its own), so it must be stripped from the PUT body
  // exactly like empresa_emisora_id is on every other tenant-scoped route —
  // otherwise a tenant could reparent its own detail line onto another
  // tenant's invoice just by naming that invoice's id in the update body.
  it('strips a spoofed factura_id out of the PUT body, preventing a cross-tenant reparent', async () => {
    invoiceDetailMock.statics.findById.mockResolvedValueOnce({ _id: ID, factura_id: 'factura-1' });
    invoiceMock.statics.findOne.mockResolvedValueOnce({ _id: 'factura-1' });
    invoiceDetailMock.statics.findByIdAndUpdate.mockResolvedValueOnce({ _id: ID });

    await request(app)
      .put(`/api/v1/invoice-detail/${ID}`)
      .set('X-API-Key', authHeader)
      .send({ cantidad: 5, factura_id: 'someone-elses-invoice' });

    const [, updateData] = invoiceDetailMock.statics.findByIdAndUpdate.mock.calls[0];
    expect(updateData).toEqual({ cantidad: 5 });
  });

  it('returns 500 when the database fails', async () => {
    invoiceDetailMock.statics.findById.mockRejectedValueOnce(new Error('mongo down'));

    const res = await request(app).get(`/api/v1/invoice-detail/${ID}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(500);
  });
});

describe('IssuingCompany routes (tenant self-service, no :id params)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    saved.length = 0;
  });

  it('returns only the authenticated company’s own record on GET /', async () => {
    issuingCompanyMock.statics.findById.mockResolvedValueOnce({ _id: ACTIVE_COMPANY_ID });

    const res = await request(app).get('/api/v1/issuing-company').set('X-API-Key', authHeader);

    expect(res.status).toBe(200);
    expect(issuingCompanyMock.statics.findById).toHaveBeenCalledWith(ACTIVE_COMPANY_ID);
  });

  it('404s GET / when the company no longer exists', async () => {
    const res = await request(app).get('/api/v1/issuing-company').set('X-API-Key', authHeader);
    expect(res.status).toBe(404);
  });

  it('updates only whitelisted fields on the authenticated company via PUT /', async () => {
    issuingCompanyMock.statics.findByIdAndUpdate.mockResolvedValueOnce({ _id: ACTIVE_COMPANY_ID });

    const res = await request(app)
      .put('/api/v1/issuing-company')
      .set('X-API-Key', authHeader)
      .send({ razon_social: 'Nueva razón social', ruc: '9999999999001', active: false, _id: 'other' });

    expect(res.status).toBe(200);
    const [calledId, updateData] = issuingCompanyMock.statics.findByIdAndUpdate.mock.calls[0];
    expect(calledId).toBe(ACTIVE_COMPANY_ID);
    expect(updateData).toEqual({ razon_social: 'Nueva razón social' });
  });

  it('404s PUT / when the company no longer exists', async () => {
    const res = await request(app).put('/api/v1/issuing-company').set('X-API-Key', authHeader).send({ a: 1 });
    expect(res.status).toBe(404);
  });

  it('has no :id-scoped routes anymore', async () => {
    const res = await request(app).get(`/api/v1/issuing-company/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);
  });

  it('returns 500 on database failures', async () => {
    issuingCompanyMock.statics.findById.mockRejectedValueOnce(new Error('mongo down'));
    const res = await request(app).get('/api/v1/issuing-company').set('X-API-Key', authHeader);
    expect(res.status).toBe(500);
  });

  describe('PUT /certificate', () => {
    beforeEach(() => {
      verifyP12PasswordMock.mockResolvedValue({ valid: true });
    });

    it('requires both certificate and certificate_password', async () => {
      const res = await request(app)
        .put('/api/v1/issuing-company/certificate')
        .set('X-API-Key', authHeader)
        .send({ certificate: 'Y2VydA==' });

      expect(res.status).toBe(400);
      expect(verifyP12PasswordMock).not.toHaveBeenCalled();
    });

    it('rejects a certificate whose password does not verify, without storing anything', async () => {
      verifyP12PasswordMock.mockResolvedValue({ valid: false, error: 'bad mac' });

      const res = await request(app)
        .put('/api/v1/issuing-company/certificate')
        .set('X-API-Key', authHeader)
        .send({ certificate: 'Y2VydA==', certificate_password: 'wrong' });

      expect(res.status).toBe(400);
      expect(issuingCompanyMock.statics.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('encrypts and stores the certificate and password at rest once the P12 verifies', async () => {
      issuingCompanyMock.statics.findByIdAndUpdate.mockResolvedValueOnce({ _id: ACTIVE_COMPANY_ID });

      const res = await request(app)
        .put('/api/v1/issuing-company/certificate')
        .set('X-API-Key', authHeader)
        .send({ certificate: 'Y2VydA==', certificate_password: 'test-new-cert-password' });

      expect(res.status).toBe(200);
      const [calledId, updateData] = issuingCompanyMock.statics.findByIdAndUpdate.mock.calls[0];
      expect(calledId).toBe(ACTIVE_COMPANY_ID);
      expect(updateData.certificate).toBeDefined();
      expect(updateData.certificate).not.toBe('Y2VydA=='); // stored encrypted
      expect(updateData.certificate_password).toBeDefined();
      expect(updateData.certificate_password).not.toBe('test-new-cert-password'); // stored encrypted
    });

    it('404s when the company no longer exists', async () => {
      const res = await request(app)
        .put('/api/v1/issuing-company/certificate')
        .set('X-API-Key', authHeader)
        .send({ certificate: 'Y2VydA==', certificate_password: 'pw' });

      expect(res.status).toBe(404);
    });
  });
});

describe('Invoice /complete route error branches', () => {
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

  it('returns 400 when the body RUC does not match the authenticated tenant, and calls the service with the authenticated companyId', async () => {
    const { InvoiceService } = require('../src/services/invoice.service');
    InvoiceService.crearFacturaCompleta.mockRejectedValueOnce(
      new Error('El RUC del comprobante no coincide con la empresa autenticada'),
    );

    const res = await request(app)
      .post('/api/v1/invoice/complete')
      .set('X-API-Key', authHeader)
      .send({ factura: { infoTributaria: { ruc: '9999999999001' } } });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('no coincide');
    expect(InvoiceService.crearFacturaCompleta).toHaveBeenCalledWith(
      { infoTributaria: { ruc: '9999999999001' } },
      ACTIVE_COMPANY_ID,
    );
  });
});

describe('InvoicePDF routes (scoped via parent Invoice lookup)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    saved.length = 0;
  });

  const CLAVE = '1705202501179001234500110010010000000011234567810';

  it('lists only PDFs whose invoices belong to the tenant', async () => {
    invoiceMock.statics.find.mockReturnValueOnce(queryReturning([{ _id: 'factura-1' }]));
    invoicePDFMock.statics.find.mockReturnValueOnce({ populate: jest.fn().mockResolvedValue([{ _id: ID }]) } as any);

    const res = await request(app).get('/api/v1/invoice-pdf').set('X-API-Key', authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(invoicePDFMock.statics.find).toHaveBeenCalledWith({ factura_id: { $in: ['factura-1'] } });
  });

  it('finds a PDF by invoice id and by access key, scoped to the tenant', async () => {
    invoiceMock.statics.findOne.mockResolvedValueOnce({ _id: ID });
    invoicePDFMock.statics.findOne.mockResolvedValueOnce({ _id: ID });
    let res = await request(app).get(`/api/v1/invoice-pdf/invoice/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);

    // Cross-tenant: the invoice lookup 404s before the PDF is even considered
    res = await request(app).get(`/api/v1/invoice-pdf/invoice/${ID}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);

    invoicePDFMock.statics.findOne.mockResolvedValueOnce({ _id: ID, claveAcceso: CLAVE, factura_id: ID });
    invoiceMock.statics.findOne.mockResolvedValueOnce({ _id: ID });
    res = await request(app).get(`/api/v1/invoice-pdf/access-key/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);
  });

  it('404s access-key lookup when the PDF’s invoice belongs to another tenant', async () => {
    invoicePDFMock.statics.findOne.mockResolvedValueOnce({ _id: ID, claveAcceso: CLAVE, factura_id: 'other-invoice' });
    // invoiceMock.statics.findOne default resolves null (not this tenant's)

    const res = await request(app).get(`/api/v1/invoice-pdf/access-key/${CLAVE}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(404);
  });

  it('redirects to a freshly-resolved download URL when the invoice belongs to the tenant', async () => {
    invoicePDFMock.statics.findOne.mockResolvedValueOnce({
      pdf_url: 'pdfs/1791234567001/1234567890',
      pdf_public_id: 'pdfs/1791234567001/1234567890',
      factura_id: ID,
    });
    invoiceMock.statics.findOne.mockResolvedValueOnce({ _id: ID });
    storageMock.getDownloadUrl.mockResolvedValueOnce('https://s3.example.com/presigned-url');

    const res = await request(app).get(`/api/v1/invoice-pdf/download/${CLAVE}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://s3.example.com/presigned-url');
    expect(storageMock.getDownloadUrl).toHaveBeenCalledWith('pdfs/1791234567001/1234567890');
  });

  it('returns 404 on download when the PDF has no stored key', async () => {
    invoicePDFMock.statics.findOne.mockResolvedValueOnce({ pdf_url: '', pdf_public_id: '', factura_id: ID });
    invoiceMock.statics.findOne.mockResolvedValueOnce({ _id: ID });

    const res = await request(app).get(`/api/v1/invoice-pdf/download/${CLAVE}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(404);
    expect(storageMock.getDownloadUrl).not.toHaveBeenCalled();
  });

  it('404s regeneration for an invoice belonging to another tenant', async () => {
    const res = await request(app).post(`/api/v1/invoice-pdf/regenerate/${ID}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(404);
  });

  it('acknowledges PDF regeneration requests for the tenant’s own invoice', async () => {
    invoiceMock.statics.findOne.mockResolvedValueOnce({ _id: ID });

    const res = await request(app).post(`/api/v1/invoice-pdf/regenerate/${ID}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.facturaId).toBe(ID);
  });

  it('sends the email and reports email status for the tenant’s own invoice', async () => {
    const doc: any = {
      email_estado: 'NO_ENVIADO',
      email_intentos: 0,
      factura_id: ID,
      save: jest.fn().mockResolvedValue({}),
    };
    invoicePDFMock.statics.findOne.mockResolvedValueOnce(doc);
    invoiceMock.statics.findOne.mockResolvedValueOnce({ _id: ID });
    sendInvoiceEmailMock.mockResolvedValueOnce({ success: true, messageId: 'resend-msg-1' });

    let res = await request(app)
      .post(`/api/v1/invoice-pdf/send-email/${CLAVE}`)
      .set('X-API-Key', authHeader)
      .send({ email_destinatario: 'cliente@test.com' });
    expect(res.status).toBe(200);
    expect(doc.email_estado).toBe('ENVIADO');
    expect(doc.email_intentos).toBe(1);
    expect(doc.email_destinatario).toBe('cliente@test.com');
    expect(sendInvoiceEmailMock).toHaveBeenCalledWith(doc, 'cliente@test.com', 'Cliente', 'Empresa');

    res = await request(app).post(`/api/v1/invoice-pdf/send-email/${CLAVE}`).set('X-API-Key', authHeader).send({});
    expect(res.status).toBe(400);

    invoicePDFMock.statics.findOne.mockResolvedValueOnce({
      email_estado: 'ENVIADO',
      email_intentos: 1,
      factura_id: ID,
    });
    invoiceMock.statics.findOne.mockResolvedValueOnce({ _id: ID });
    res = await request(app).get(`/api/v1/invoice-pdf/email-status/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.email_estado).toBe('ENVIADO');
  });

  it('marks the email as ERROR and records the failure when sending fails', async () => {
    const doc: any = {
      email_estado: 'NO_ENVIADO',
      email_intentos: 0,
      factura_id: ID,
      save: jest.fn().mockResolvedValue({}),
    };
    invoicePDFMock.statics.findOne.mockResolvedValueOnce(doc);
    invoiceMock.statics.findOne.mockResolvedValueOnce({ _id: ID });
    sendInvoiceEmailMock.mockResolvedValueOnce({ success: false, error: 'Resend rejected the request' });

    const res = await request(app)
      .post(`/api/v1/invoice-pdf/send-email/${CLAVE}`)
      .set('X-API-Key', authHeader)
      .send({ email_destinatario: 'cliente@test.com' });

    expect(res.status).toBe(200);
    expect(doc.email_estado).toBe('ERROR');
    expect(doc.email_intentos).toBe(1);
    expect(doc.email_ultimo_error).toBe('Resend rejected the request');
    expect(res.body.error).toBe('Resend rejected the request');
  });

  it('404s email-status and send-email for another tenant’s invoice', async () => {
    invoicePDFMock.statics.findOne.mockResolvedValueOnce({ email_estado: 'PENDIENTE', factura_id: 'other-invoice' });
    let res = await request(app).get(`/api/v1/invoice-pdf/email-status/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(404);

    invoicePDFMock.statics.findOne.mockResolvedValueOnce({ factura_id: 'other-invoice' });
    res = await request(app)
      .post(`/api/v1/invoice-pdf/send-email/${CLAVE}`)
      .set('X-API-Key', authHeader)
      .send({ email_destinatario: 'cliente@test.com' });
    expect(res.status).toBe(404);
  });

  it('handles email retries and the already-sent case for the tenant’s own invoice', async () => {
    const doc: any = {
      email_estado: 'ERROR',
      email_intentos: 1,
      email_destinatario: 'cliente@test.com',
      factura_id: ID,
      save: jest.fn().mockResolvedValue({}),
    };
    invoicePDFMock.statics.findOne.mockResolvedValueOnce(doc);
    invoiceMock.statics.findOne.mockResolvedValueOnce({ _id: ID });
    sendInvoiceEmailMock.mockResolvedValueOnce({ success: true, messageId: 'resend-msg-2' });

    let res = await request(app).post(`/api/v1/invoice-pdf/retry-email/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(200);
    expect(doc.email_estado).toBe('ENVIADO');
    expect(doc.email_intentos).toBe(2);
    expect(sendInvoiceEmailMock).toHaveBeenCalledWith(doc, 'cliente@test.com', 'Cliente', 'Empresa');

    invoicePDFMock.statics.findOne.mockResolvedValueOnce({ email_estado: 'ENVIADO', factura_id: ID });
    invoiceMock.statics.findOne.mockResolvedValueOnce({ _id: ID });
    res = await request(app).post(`/api/v1/invoice-pdf/retry-email/${CLAVE}`).set('X-API-Key', authHeader);
    expect(res.status).toBe(400);
  });

  it('400s a retry when there is no recipient email on file', async () => {
    invoicePDFMock.statics.findOne.mockResolvedValueOnce({ email_estado: 'ERROR', factura_id: ID });
    invoiceMock.statics.findOne.mockResolvedValueOnce({ _id: ID });

    const res = await request(app).post(`/api/v1/invoice-pdf/retry-email/${CLAVE}`).set('X-API-Key', authHeader);

    expect(res.status).toBe(400);
    expect(sendInvoiceEmailMock).not.toHaveBeenCalled();
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

  it('returns 500 on database failures for every endpoint', async () => {
    invoiceMock.statics.find.mockReturnValueOnce(queryReturning([]));
    invoicePDFMock.statics.find.mockReturnValueOnce({
      populate: jest.fn().mockRejectedValue(new Error('mongo down')),
    } as any);
    let res = await request(app).get('/api/v1/invoice-pdf').set('X-API-Key', authHeader);
    expect(res.status).toBe(500);

    invoiceMock.statics.findOne.mockRejectedValueOnce(new Error('mongo down'));
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
});
