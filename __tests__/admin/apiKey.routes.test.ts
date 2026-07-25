import request from 'supertest';
import jwt from 'jsonwebtoken';
import { hashApiKey } from '../../src/utils/apiKey.utils';

function createApiKeyMock() {
  const statics = {
    find: jest.fn().mockReturnValue([]),
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
    saveMock: jest.fn().mockResolvedValue(undefined),
  };
  const saved: any[] = [];
  let nextId = 1;

  class MockModel {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      this._id = `api-key-${nextId++}`;
      this.createdAt = new Date('2024-01-01T00:00:00.000Z');
      saved.push(this);
    }
    save = () => statics.saveMock(this);
    get(field: string) {
      return this[field];
    }
    static find = (...args: any[]) => {
      const result: any = Promise.resolve(statics.find(...args));
      result.select = () => result;
      result.sort = () => result;
      return result;
    };
    static findOneAndUpdate = (...args: any[]) => {
      const result: any = Promise.resolve(statics.findOneAndUpdate(...args));
      result.select = () => result;
      return result;
    };
  }

  return { MockModel, statics, saved };
}

const apiKeyMock = createApiKeyMock();
jest.mock('../../src/models/ApiKey', () => ({
  __esModule: true,
  default: apiKeyMock.MockModel,
}));

const issuingCompanyFindByIdMock = jest.fn().mockResolvedValue({ _id: 'company-1' });
jest.mock('../../src/models/IssuingCompany', () => ({
  __esModule: true,
  default: {
    findById: (...args: any[]) => issuingCompanyFindByIdMock(...args),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createApp } = require('../../src/testApp');
const app = createApp();

const ADMIN_TOKEN = jwt.sign({ userId: 'admin-1', role: 'admin' }, process.env.JWT_SECRET as string, {
  expiresIn: '4d',
});

describe('Admin API key routes (/admin/api/tenants/:id/api-keys)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiKeyMock.saved.length = 0;
    apiKeyMock.statics.find.mockReturnValue([]);
    apiKeyMock.statics.findOneAndUpdate.mockResolvedValue(null);
    apiKeyMock.statics.saveMock.mockResolvedValue(undefined);
    issuingCompanyFindByIdMock.mockResolvedValue({ _id: 'company-1' });
  });

  describe('adminAuth guard', () => {
    it('rejects requests with no token at all', async () => {
      const res = await request(app).get('/admin/api/tenants/company-1/api-keys');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /', () => {
    it('lists API keys without ever including key_hash', async () => {
      apiKeyMock.statics.find.mockReturnValue([{ _id: 'api-key-1', prefix: 'sk_live_abcd', name: 'Prod' }]);

      const res = await request(app)
        .get('/admin/api/tenants/company-1/api-keys')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ _id: 'api-key-1', prefix: 'sk_live_abcd', name: 'Prod' }]);
      expect(JSON.stringify(res.body)).not.toContain('key_hash');
    });
  });

  describe('POST /', () => {
    it('returns 404 when the tenant does not exist', async () => {
      issuingCompanyFindByIdMock.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/admin/api/tenants/does-not-exist/api-keys')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ name: 'Prod' });

      expect(res.status).toBe(404);
    });

    it('rejects a missing name', async () => {
      const res = await request(app)
        .post('/admin/api/tenants/company-1/api-keys')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('creates an API key and returns the raw token exactly once, hashed correctly at rest', async () => {
      const res = await request(app)
        .post('/admin/api/tenants/company-1/api-keys')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ name: 'Production key' });

      expect(res.status).toBe(201);
      expect(res.body.token).toMatch(/^sk_live_/);
      expect(res.body.prefix).toBe(res.body.token.slice(0, 12));

      expect(apiKeyMock.saved).toHaveLength(1);
      const stored = apiKeyMock.saved[0];
      expect(stored.empresa_emisora_id).toBe('company-1');
      expect(stored.created_by).toBe('admin-1');
      expect(stored.key_hash).toBe(hashApiKey(res.body.token));
      // The stored record never carries the raw token itself.
      expect(stored.token).toBeUndefined();
      expect(JSON.stringify(stored)).not.toContain(res.body.token.slice(8));
    });
  });

  describe('DELETE /:keyId', () => {
    it('returns 404 when the key does not belong to this tenant (or does not exist)', async () => {
      const res = await request(app)
        .delete('/admin/api/tenants/company-1/api-keys/api-key-999')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(404);
    });

    it('sets revoked_at rather than hard-deleting the key', async () => {
      apiKeyMock.statics.findOneAndUpdate.mockResolvedValueOnce({
        _id: 'api-key-1',
        revoked_at: new Date(),
      });

      const res = await request(app)
        .delete('/admin/api/tenants/company-1/api-keys/api-key-1')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.revoked_at).toBeDefined();
      const [filterArg, updateArg] = apiKeyMock.statics.findOneAndUpdate.mock.calls[0];
      expect(filterArg).toEqual({ _id: 'api-key-1', empresa_emisora_id: 'company-1' });
      expect(updateArg.revoked_at).toBeInstanceOf(Date);
    });
  });
});
