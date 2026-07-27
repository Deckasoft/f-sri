import request from 'supertest';
import jwt from 'jsonwebtoken';

// Same hand-rolled mock convention as __tests__/admin/tenant.routes.test.ts.
const sequenceStatics = {
  find: jest.fn().mockReturnValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  findOneAndUpdate: jest.fn().mockResolvedValue(null),
};

const auditStatics = {
  create: jest.fn().mockResolvedValue({}),
};

const companyStatics = {
  findById: jest.fn().mockResolvedValue(null),
};

jest.mock('../../src/models/Sequence', () => ({
  __esModule: true,
  default: {
    find: (...args: any[]) => {
      const result: any = Promise.resolve(sequenceStatics.find(...args));
      result.lean = () => result;
      return result;
    },
    findOne: (...args: any[]) => sequenceStatics.findOne(...args),
    findOneAndUpdate: (...args: any[]) => sequenceStatics.findOneAndUpdate(...args),
  },
}));

jest.mock('../../src/models/SequenceAudit', () => ({
  __esModule: true,
  default: { create: (...args: any[]) => auditStatics.create(...args) },
}));

jest.mock('../../src/models/IssuingCompany', () => ({
  __esModule: true,
  default: { findById: (...args: any[]) => companyStatics.findById(...args) },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createApp } = require('../../src/testApp');
const app = createApp();

const ADMIN_TOKEN = jwt.sign({ userId: 'admin-1', role: 'admin' }, process.env.JWT_SECRET as string, {
  expiresIn: '4d',
});

const TENANT_ID = '507f1f77bcf86cd799439011';

const createMockCompany = () => ({
  _id: TENANT_ID,
  tipo_ambiente: 1,
  codigo_establecimiento: '001',
  punto_emision: '002',
});

/** The Sequence document key the route targets for the company above. */
const expectedKey = {
  empresa_emisora_id: TENANT_ID,
  tipo_ambiente: 1,
  codigo_establecimiento: '001',
  punto_emision: '002',
  document_type: '01',
};

const seed = (body: object, documentType = '01') =>
  request(app)
    .put(`/admin/api/tenants/${TENANT_ID}/sequences/${documentType}`)
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
    .send(body);

describe('Admin sequence seeding (/admin/api/tenants/:id/sequences)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    companyStatics.findById.mockResolvedValue(createMockCompany());
    sequenceStatics.find.mockReturnValue([]);
    sequenceStatics.findOneAndUpdate.mockResolvedValue(null);
  });

  it('creates a counter that does not exist yet and records the audit with from: null', async () => {
    const res = await seed({ ultimo_secuencial: 47 });

    expect(res.status).toBe(200);
    expect(res.body.ultimo_secuencial).toBe(47);
    // Seeding "last used = 47" must make the NEXT document 000000048, not 47.
    expect(res.body.proximo_secuencial).toBe('000000048');
    expect(res.body.actualizado).toBe(true);

    // Raise-only is enforced by the update operator, not by application logic.
    expect(sequenceStatics.findOneAndUpdate).toHaveBeenCalledWith(
      expectedKey,
      { $max: { current: 47 } },
      { upsert: true, new: false },
    );
    expect(auditStatics.create).toHaveBeenCalledWith(expect.objectContaining({ from: null, to: 47 }));
  });

  it('raises an existing counter and records what it changed from', async () => {
    sequenceStatics.findOneAndUpdate.mockResolvedValue({ current: 47 });

    const res = await seed({ ultimo_secuencial: 148 });

    expect(res.status).toBe(200);
    expect(res.body.actualizado).toBe(true);
    expect(auditStatics.create).toHaveBeenCalledWith(
      expect.objectContaining({ from: 47, to: 148, changed_by: 'admin-1' }),
    );
  });

  // Lowering is the one operation that guarantees duplicate claves de acceso,
  // so it is refused outright rather than confirmed. There is no override.
  it('refuses to lower a counter with 409 and writes no audit row', async () => {
    sequenceStatics.findOneAndUpdate.mockResolvedValue({ current: 148 });

    const res = await seed({ ultimo_secuencial: 47 });

    expect(res.status).toBe(409);
    expect(res.body.ultimo_secuencial).toBe(148);
    expect(auditStatics.create).not.toHaveBeenCalled();
  });

  it('treats re-seeding the same value as a no-op without an audit row', async () => {
    sequenceStatics.findOneAndUpdate.mockResolvedValue({ current: 47 });

    const res = await seed({ ultimo_secuencial: 47 });

    expect(res.status).toBe(200);
    expect(res.body.actualizado).toBe(false);
    expect(auditStatics.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown document type before touching the counter', async () => {
    const res = await seed({ ultimo_secuencial: 47 }, '99');

    expect(res.status).toBe(400);
    expect(sequenceStatics.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['negative', -1],
    ['non-integer', 4.5],
    ['above the 9-digit ceiling', 1_000_000_000],
  ])('rejects a %s secuencial', async (_label, value) => {
    const res = await seed({ ultimo_secuencial: value });

    expect(res.status).toBe(400);
    expect(sequenceStatics.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('404s for a tenant that does not exist', async () => {
    companyStatics.findById.mockResolvedValue(null);

    const res = await seed({ ultimo_secuencial: 47 });

    expect(res.status).toBe(404);
    expect(sequenceStatics.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('requires admin authentication', async () => {
    const res = await request(app).put(`/admin/api/tenants/${TENANT_ID}/sequences/01`).send({ ultimo_secuencial: 47 });

    expect(res.status).toBe(401);
  });

  describe('GET /', () => {
    it('reports every document type for the active series, defaulting to 0', async () => {
      sequenceStatics.find.mockReturnValue([
        { tipo_ambiente: 1, codigo_establecimiento: '001', punto_emision: '002', document_type: '01', current: 47 },
      ]);

      const res = await request(app)
        .get(`/admin/api/tenants/${TENANT_ID}/sequences`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.serie).toEqual({ tipo_ambiente: 1, codigo_establecimiento: '001', punto_emision: '002' });
      expect(res.body.secuenciales).toHaveLength(5);

      const factura = res.body.secuenciales.find((s: any) => s.document_type === '01');
      expect(factura).toMatchObject({ ultimo_secuencial: 47, existe: true });

      const notaCredito = res.body.secuenciales.find((s: any) => s.document_type === '04');
      expect(notaCredito).toMatchObject({ ultimo_secuencial: 0, existe: false });
    });

    // A tenant promoted to producción keeps its pruebas counters; they must
    // stay visible so nobody mistakes the fresh production series for data loss.
    it('separates counters belonging to other series', async () => {
      sequenceStatics.find.mockReturnValue([
        { tipo_ambiente: 1, codigo_establecimiento: '001', punto_emision: '002', document_type: '01', current: 47 },
        { tipo_ambiente: 2, codigo_establecimiento: '001', punto_emision: '002', document_type: '01', current: 3 },
      ]);

      const res = await request(app)
        .get(`/admin/api/tenants/${TENANT_ID}/sequences`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.otras_series).toHaveLength(1);
      expect(res.body.otras_series[0]).toMatchObject({ tipo_ambiente: 2, ultimo_secuencial: 3 });
    });
  });
});
