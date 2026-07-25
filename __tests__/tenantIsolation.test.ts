import request from 'supertest';
import { hashApiKey } from '../src/utils/apiKey.utils';

/**
 * Dedicated multi-tenant isolation suite (Phase 3).
 *
 * Unlike crud.routes.test.ts (which mostly asserts that a *single* tenant's
 * requests build the expected `{ empresa_emisora_id }` filter), this file
 * wires up TWO independent, fully authenticated tenants — each with its own
 * API key and its own IssuingCompany — and a real, filtering, in-memory
 * Client store, so that cross-tenant reads/writes/deletes are proven to
 * actually fail against real per-tenant data, not merely asserted to have
 * been called with the "right" arguments against a mock that would have
 * answered the same way regardless.
 *
 * Covers (per the Phase 3 brief):
 *  - cross-tenant GET/PUT/DELETE by id -> 404 (never 403, never someone
 *    else's data)
 *  - tenant A's list never includes tenant B's records, and vice versa
 *  - RUC mismatch on /invoice/complete emission -> 400
 *  - emission resolves and uses the AUTHENTICATED tenant's own company
 *    (never one derived from the request body)
 */

const TOKEN_A = 'sk_live_tenant_a_aaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'sk_live_tenant_b_bbbbbbbbbbbbbbbbbbbb';
const COMPANY_A_ID = 'company-a';
const COMPANY_B_ID = 'company-b';

const companyA = {
  _id: COMPANY_A_ID,
  ruc: '1790012345001',
  razon_social: 'EMPRESA A S.A.',
  nombre_comercial: 'EMPRESA A',
  codigo_establecimiento: '001',
  punto_emision: '001',
  tipo_ambiente: 1,
  tipo_emision: 1,
  direccion_matriz: 'Av. A',
  direccion_establecimiento: 'Av. A',
  obligado_contabilidad: true,
  // Deliberately no certificate/certificate_password: crearFacturaCompleta's
  // fire-and-forget procesarEnvioSRI call then takes its "no certificate
  // configured" early-return branch, so this file doesn't also need to mock
  // firma/sri/pdf/storage utils to exercise the RUC/company-resolution logic
  // this suite actually cares about.
  toObject() {
    return { ...this };
  },
};

const companyB = {
  ...companyA,
  _id: COMPANY_B_ID,
  ruc: '1790099999001',
  razon_social: 'EMPRESA B S.A.',
  nombre_comercial: 'EMPRESA B',
  toObject() {
    return { ...this };
  },
};

// --- ApiKey mock: two tenants, distinguished by the SHA-256 hash of their
// real (unmocked) token, exactly like apiKeyAuth computes it in production. ---
const apiKeyRecordsByHash: Record<string, any> = {
  [hashApiKey(TOKEN_A)]: {
    _id: 'api-key-a',
    revoked_at: undefined,
    last_used_at: undefined,
    empresa_emisora_id: { _id: COMPANY_A_ID, active: true },
  },
  [hashApiKey(TOKEN_B)]: {
    _id: 'api-key-b',
    revoked_at: undefined,
    last_used_at: undefined,
    empresa_emisora_id: { _id: COMPANY_B_ID, active: true },
  },
};
const apiKeyFindOneMock = jest.fn((...args: any[]) => {
  const [filter] = args as [{ key_hash: string }];
  return apiKeyRecordsByHash[filter.key_hash] ?? null;
});
jest.mock('../src/models/ApiKey', () => ({
  __esModule: true,
  default: {
    findOne: (...args: any[]) => {
      const result = Promise.resolve(apiKeyFindOneMock(...args));
      const query: any = result;
      query.populate = () => result;
      return query;
    },
    findByIdAndUpdate: jest.fn().mockResolvedValue(null),
  },
}));

// --- IssuingCompany mock: findById resolves whichever tenant's own company
// was asked for — never the other tenant's, and never one picked by RUC. ---
const issuingCompanyFindByIdMock = jest.fn((...args: any[]) => {
  const [companyId] = args as [string];
  if (companyId === COMPANY_A_ID) return companyA;
  if (companyId === COMPANY_B_ID) return companyB;
  return null;
});
jest.mock('../src/models/IssuingCompany', () => ({
  __esModule: true,
  default: {
    findById: (...args: any[]) => {
      const result = Promise.resolve(issuingCompanyFindByIdMock(...args));
      const query: any = result;
      query.select = () => result;
      return query;
    },
  },
}));

// --- Client mock: a real tenant-scoped store. Every static method actually
// filters the in-memory documents by the given fields (rather than being a
// jest.fn() whose canned return value is the same no matter who asks), so
// cross-tenant access is proven to fail against real per-tenant data. ---
function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value));
}

let clientDocs: Array<Record<string, any>> = [];
let nextClientId = 1;

class MockClient {
  [key: string]: any;
  constructor(data: Record<string, unknown>) {
    Object.assign(this, data);
    this._id = data._id ?? `client-${nextClientId++}`;
  }
  async save() {
    clientDocs.push({ ...this });
    return this;
  }
  static async find(filter: Record<string, unknown> = {}) {
    return clientDocs.filter((doc) => matchesFilter(doc, filter));
  }
  static async findOne(filter: Record<string, unknown> = {}) {
    return clientDocs.find((doc) => matchesFilter(doc, filter)) ?? null;
  }
  static async findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>) {
    const doc = clientDocs.find((candidate) => matchesFilter(candidate, filter));
    if (!doc) return null;
    Object.assign(doc, update);
    return { ...doc };
  }
  static async findOneAndDelete(filter: Record<string, unknown>) {
    const index = clientDocs.findIndex((candidate) => matchesFilter(candidate, filter));
    if (index === -1) return null;
    const [removed] = clientDocs.splice(index, 1);
    return removed;
  }
}
jest.mock('../src/models/Client', () => ({ __esModule: true, default: MockClient }));

// --- Remaining models needed to exercise /invoice/complete end-to-end.
// None of these are what this suite is testing, so they're simple,
// tenant-agnostic stand-ins (buscarClient, tested above via Client, is the
// only one of these five lookups that's actually tenant-scoped). ---
const identificationTypeFindOneMock = jest.fn().mockResolvedValue({ codigo: '05' });
jest.mock('../src/models/IdentificationType', () => ({
  __esModule: true,
  default: { findOne: (...args: any[]) => identificationTypeFindOneMock(...args) },
}));

const productFindOneMock = jest.fn().mockResolvedValue({
  _id: 'product-1',
  codigo: 'P001',
  tiene_iva: true,
  precio_unitario: 100,
});
jest.mock('../src/models/Product', () => ({
  __esModule: true,
  default: { findOne: (...args: any[]) => productFindOneMock(...args) },
}));

let sequenceCounter = 0;
const sequenceFindOneAndUpdateMock = jest.fn(async (..._args: any[]) => {
  sequenceCounter += 1;
  return { current: sequenceCounter };
});
jest.mock('../src/models/Sequence', () => ({
  __esModule: true,
  default: { findOneAndUpdate: (...args: any[]) => sequenceFindOneAndUpdateMock(...args) },
}));

const savedInvoices: Array<Record<string, any>> = [];
class MockInvoice {
  [key: string]: any;
  constructor(data: Record<string, unknown>) {
    Object.assign(this, data);
    this._id = `invoice-${savedInvoices.length + 1}`;
    savedInvoices.push(this);
  }
  save = jest.fn().mockResolvedValue(this);
}
jest.mock('../src/models/Invoice', () => ({ __esModule: true, default: MockInvoice }));

const savedInvoiceDetails: Array<Record<string, any>> = [];
class MockInvoiceDetail {
  [key: string]: any;
  constructor(data: Record<string, unknown>) {
    Object.assign(this, data);
    savedInvoiceDetails.push(this);
  }
  save = jest.fn().mockResolvedValue(this);
}
jest.mock('../src/models/InvoiceDetail', () => ({ __esModule: true, default: MockInvoiceDetail }));

// Loaded after every jest.mock() above so the hoisted factories can see the
// model doubles when the route files import them.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createApp } = require('../src/testApp');

const app = createApp();

const facturaPayload = (ruc: string) => ({
  infoTributaria: { ruc, claveAcceso: '', secuencial: '' },
  infoFactura: {
    fechaEmision: '17/05/2025',
    tipoIdentificacionComprador: '05',
    identificacionComprador: '0106079783',
    razonSocialComprador: 'CLIENTE COMPARTIDO',
    totalSinImpuestos: '100.00',
    importeTotal: '115.00',
  },
  detalles: [
    {
      detalle: {
        codigoPrincipal: 'P001',
        descripcion: 'Producto',
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
});

describe('Tenant isolation — two independent, fully authenticated tenants', () => {
  beforeEach(() => {
    clientDocs = [];
    nextClientId = 1;
    savedInvoices.length = 0;
    savedInvoiceDetails.length = 0;
    sequenceCounter = 0;
    issuingCompanyFindByIdMock.mockClear();

    // Both tenants each register a client under the SAME natural
    // identificacion — exactly the scenario the compound
    // {empresa_emisora_id, identificacion} unique index on Client (Phase 3)
    // exists to allow, and a good stress-test of tenant scoping: a naive
    // `Client.findOne({ identificacion })` would ambiguously match either.
    clientDocs.push({
      _id: 'client-a-1',
      empresa_emisora_id: COMPANY_A_ID,
      identificacion: '0106079783',
      razon_social: 'CLIENTE A',
    });
    clientDocs.push({
      _id: 'client-b-1',
      empresa_emisora_id: COMPANY_B_ID,
      identificacion: '0106079783',
      razon_social: 'CLIENTE B',
    });
  });

  describe('generic tenant-scoped CRUD (Client) backed by real per-tenant data', () => {
    it("tenant A's list never includes tenant B's records, and vice versa", async () => {
      const resA = await request(app).get('/api/v1/client').set('X-API-Key', TOKEN_A);
      const resB = await request(app).get('/api/v1/client').set('X-API-Key', TOKEN_B);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      expect(resA.body.map((doc: any) => doc._id)).toEqual(['client-a-1']);
      expect(resB.body.map((doc: any) => doc._id)).toEqual(['client-b-1']);
    });

    it('tenant B GETting a client belonging to tenant A gets 404, never 403 and never the record', async () => {
      const res = await request(app).get('/api/v1/client/client-a-1').set('X-API-Key', TOKEN_B);

      expect(res.status).toBe(404);
      expect(res.status).not.toBe(403);
      expect(res.body.razon_social).toBeUndefined();
    });

    it('tenant A can GET its own client', async () => {
      const res = await request(app).get('/api/v1/client/client-a-1').set('X-API-Key', TOKEN_A);

      expect(res.status).toBe(200);
      expect(res.body.razon_social).toBe('CLIENTE A');
    });

    it('tenant B cannot PUT (update) a client belonging to tenant A', async () => {
      const res = await request(app)
        .put('/api/v1/client/client-a-1')
        .set('X-API-Key', TOKEN_B)
        .send({ razon_social: 'HIJACKED' });

      expect(res.status).toBe(404);
      expect(clientDocs.find((doc) => doc._id === 'client-a-1')?.razon_social).toBe('CLIENTE A');
    });

    it('tenant B cannot DELETE a client belonging to tenant A', async () => {
      const res = await request(app).delete('/api/v1/client/client-a-1').set('X-API-Key', TOKEN_B);

      expect(res.status).toBe(404);
      expect(clientDocs.some((doc) => doc._id === 'client-a-1')).toBe(true);
    });

    it('tenant A CAN update and delete its own client', async () => {
      const putRes = await request(app)
        .put('/api/v1/client/client-a-1')
        .set('X-API-Key', TOKEN_A)
        .send({ razon_social: 'CLIENTE A RENOMBRADO' });
      expect(putRes.status).toBe(200);
      expect(clientDocs.find((doc) => doc._id === 'client-a-1')?.razon_social).toBe('CLIENTE A RENOMBRADO');

      const deleteRes = await request(app).delete('/api/v1/client/client-a-1').set('X-API-Key', TOKEN_A);
      expect(deleteRes.status).toBe(200);
      expect(clientDocs.some((doc) => doc._id === 'client-a-1')).toBe(false);
    });
  });

  describe('/invoice/complete — RUC mismatch and emission bound to the authenticated tenant', () => {
    it('returns 400 when the body RUC belongs to the OTHER tenant, not the authenticated one', async () => {
      const res = await request(app)
        .post('/api/v1/invoice/complete')
        .set('X-API-Key', TOKEN_A)
        .send({ factura: facturaPayload(companyB.ruc) });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('no coincide con la empresa autenticada');

      // The authenticated tenant's own company was resolved (in order to
      // compare its RUC against the body) — tenant B's was never looked up,
      // even though tenant B's RUC is what appeared in the request body.
      expect(issuingCompanyFindByIdMock).toHaveBeenCalledWith(COMPANY_A_ID);
      expect(issuingCompanyFindByIdMock).not.toHaveBeenCalledWith(COMPANY_B_ID);
      expect(savedInvoices).toHaveLength(0);
    });

    it("emits using tenant A's own company when tenant A's own RUC is declared, never one derived from the body", async () => {
      const res = await request(app)
        .post('/api/v1/invoice/complete')
        .set('X-API-Key', TOKEN_A)
        .send({ factura: facturaPayload(companyA.ruc) });

      expect(res.status).toBe(201);
      expect(issuingCompanyFindByIdMock).toHaveBeenCalledWith(COMPANY_A_ID);
      expect(issuingCompanyFindByIdMock).not.toHaveBeenCalledWith(COMPANY_B_ID);
      expect(savedInvoices).toHaveLength(1);
      expect(savedInvoices[0].empresa_emisora_id).toBe(COMPANY_A_ID);
    });

    it("emits using tenant B's own company when authenticated as tenant B, independently of tenant A", async () => {
      const res = await request(app)
        .post('/api/v1/invoice/complete')
        .set('X-API-Key', TOKEN_B)
        .send({ factura: facturaPayload(companyB.ruc) });

      expect(res.status).toBe(201);
      expect(issuingCompanyFindByIdMock).toHaveBeenCalledWith(COMPANY_B_ID);
      expect(issuingCompanyFindByIdMock).not.toHaveBeenCalledWith(COMPANY_A_ID);
      expect(savedInvoices).toHaveLength(1);
      expect(savedInvoices[0].empresa_emisora_id).toBe(COMPANY_B_ID);
    });

    it("tenant B declaring tenant A's RUC is rejected with 400 too (mismatch is symmetric)", async () => {
      const res = await request(app)
        .post('/api/v1/invoice/complete')
        .set('X-API-Key', TOKEN_B)
        .send({ factura: facturaPayload(companyA.ruc) });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('no coincide con la empresa autenticada');
      expect(savedInvoices).toHaveLength(0);
    });
  });
});
