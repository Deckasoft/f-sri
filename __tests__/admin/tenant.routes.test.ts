import request from 'supertest';
import jwt from 'jsonwebtoken';

function createIssuingCompanyMock() {
  const statics = {
    find: jest.fn().mockReturnValue([]),
    findById: jest.fn().mockResolvedValue(null),
    findByIdAndUpdate: jest.fn().mockResolvedValue(null),
    saveMock: jest.fn().mockResolvedValue(undefined),
  };
  const saved: any[] = [];
  let nextId = 1;

  class MockModel {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      this._id = `company-${nextId++}`;
      saved.push(this);
    }
    save = () => statics.saveMock(this);
    static find = (...args: any[]) => {
      const result: any = Promise.resolve(statics.find(...args));
      result.sort = () => result;
      return result;
    };
    static findById = (...args: any[]) => statics.findById(...args);
    static findByIdAndUpdate = (...args: any[]) => statics.findByIdAndUpdate(...args);
  }

  return { MockModel, statics, saved };
}

const issuingCompanyMock = createIssuingCompanyMock();
jest.mock('../../src/models/IssuingCompany', () => ({
  __esModule: true,
  default: issuingCompanyMock.MockModel,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createApp } = require('../../src/testApp');
const app = createApp();

const ADMIN_TOKEN = jwt.sign({ userId: 'admin-1', role: 'admin' }, process.env.JWT_SECRET as string, {
  expiresIn: '4d',
});

const VALID_RUC = '1790012345001';

const validTenantBody = {
  ruc: VALID_RUC,
  razon_social: 'EMPRESA DEMO S.A.',
  nombre_comercial: 'EMPRESA DEMO',
};

describe('Admin tenant routes (/admin/api/tenants)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    issuingCompanyMock.saved.length = 0;
    issuingCompanyMock.statics.find.mockReturnValue([]);
    issuingCompanyMock.statics.findById.mockResolvedValue(null);
    issuingCompanyMock.statics.findByIdAndUpdate.mockResolvedValue(null);
    issuingCompanyMock.statics.saveMock.mockResolvedValue(undefined);
  });

  describe('adminAuth guard', () => {
    it('rejects requests with no token at all', async () => {
      const res = await request(app).get('/admin/api/tenants');
      expect(res.status).toBe(401);
    });

    it('rejects an /api/v1 API key presented as a Bearer token (not an admin JWT)', async () => {
      const res = await request(app)
        .get('/admin/api/tenants')
        .set('Authorization', 'Bearer sk_live_someRandomApiKeyToken1234567890');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /', () => {
    it('lists tenants for an authenticated admin', async () => {
      issuingCompanyMock.statics.find.mockReturnValue([{ _id: 'company-1', ruc: VALID_RUC }]);

      const res = await request(app).get('/admin/api/tenants').set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ _id: 'company-1', ruc: VALID_RUC }]);
    });
  });

  describe('POST /', () => {
    it('rejects an invalid RUC', async () => {
      const res = await request(app)
        .post('/admin/api/tenants')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ ...validTenantBody, ruc: '123' });

      expect(res.status).toBe(400);
      expect(issuingCompanyMock.saved).toHaveLength(0);
    });

    it('creates a tenant, stamping created_by from the authenticated admin', async () => {
      const res = await request(app)
        .post('/admin/api/tenants')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send(validTenantBody);

      expect(res.status).toBe(201);
      expect(issuingCompanyMock.saved).toHaveLength(1);
      expect(issuingCompanyMock.saved[0].created_by).toBe('admin-1');
      expect(issuingCompanyMock.saved[0].ruc).toBe(VALID_RUC);
    });

    it('never accepts certificate, certificate_password, active, or onboarded_at from the request body', async () => {
      const res = await request(app)
        .post('/admin/api/tenants')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({
          ...validTenantBody,
          certificate: 'should-be-ignored',
          certificate_password: 'should-be-ignored',
          active: false,
          onboarded_at: new Date().toISOString(),
        });

      expect(res.status).toBe(201);
      const created = issuingCompanyMock.saved[0];
      expect(created.certificate).toBeUndefined();
      expect(created.certificate_password).toBeUndefined();
      expect(created.active).toBeUndefined();
      expect(created.onboarded_at).toBeUndefined();
    });

    it('returns 409 (not 500) on a duplicate RUC', async () => {
      issuingCompanyMock.statics.saveMock.mockRejectedValueOnce({ code: 11000 });

      const res = await request(app)
        .post('/admin/api/tenants')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send(validTenantBody);

      expect(res.status).toBe(409);
    });
  });

  describe('GET /:id', () => {
    it('returns 404 when the tenant does not exist', async () => {
      const res = await request(app)
        .get('/admin/api/tenants/does-not-exist')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
      expect(res.status).toBe(404);
    });

    it('returns the tenant when found', async () => {
      issuingCompanyMock.statics.findById.mockResolvedValueOnce({ _id: 'company-1', ruc: VALID_RUC });

      const res = await request(app).get('/admin/api/tenants/company-1').set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.ruc).toBe(VALID_RUC);
    });
  });

  describe('PUT /:id', () => {
    it('rejects an invalid tipo_ambiente value (not just names, values too)', async () => {
      const res = await request(app)
        .put('/admin/api/tenants/company-1')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ tipo_ambiente: 99 });

      expect(res.status).toBe(400);
      expect(issuingCompanyMock.statics.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('strips disallowed fields (ruc, active, certificate) and updates only whitelisted ones', async () => {
      issuingCompanyMock.statics.findByIdAndUpdate.mockResolvedValueOnce({
        _id: 'company-1',
        razon_social: 'NUEVO NOMBRE',
      });

      const res = await request(app)
        .put('/admin/api/tenants/company-1')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ razon_social: 'NUEVO NOMBRE', ruc: '9999999999001', active: false, certificate: 'x' });

      expect(res.status).toBe(200);
      const [, updateArg] = issuingCompanyMock.statics.findByIdAndUpdate.mock.calls[0];
      expect(updateArg).toEqual({ razon_social: 'NUEVO NOMBRE' });
    });

    it('returns 404 when the tenant does not exist', async () => {
      const res = await request(app)
        .put('/admin/api/tenants/does-not-exist')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ razon_social: 'X' });

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /:id/active', () => {
    it('rejects a non-boolean active value', async () => {
      const res = await request(app)
        .put('/admin/api/tenants/company-1/active')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ active: 'yes' });

      expect(res.status).toBe(400);
    });

    it('flips active via the dedicated endpoint', async () => {
      issuingCompanyMock.statics.findByIdAndUpdate.mockResolvedValueOnce({ _id: 'company-1', active: false });

      const res = await request(app)
        .put('/admin/api/tenants/company-1/active')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ active: false });

      expect(res.status).toBe(200);
      expect(issuingCompanyMock.statics.findByIdAndUpdate).toHaveBeenCalledWith(
        'company-1',
        { active: false },
        { new: true },
      );
    });
  });
});
