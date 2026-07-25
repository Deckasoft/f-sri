import request from 'supertest';
import jwt from 'jsonwebtoken';

const usageEventAggregateMock = jest.fn().mockResolvedValue([]);
jest.mock('../../src/models/UsageEvent', () => ({
  __esModule: true,
  default: {
    aggregate: (...args: any[]) => usageEventAggregateMock(...args),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createApp } = require('../../src/testApp');
const app = createApp();

const ADMIN_TOKEN = jwt.sign({ userId: 'admin-1', role: 'admin' }, process.env.JWT_SECRET as string, {
  expiresIn: '4d',
});

const VALID_OBJECT_ID = '507f1f77bcf86cd799439011';

describe('Admin usage routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usageEventAggregateMock.mockResolvedValue([]);
  });

  describe('adminAuth guard', () => {
    it('rejects requests with no token at all', async () => {
      const res = await request(app).get(`/admin/api/tenants/${VALID_OBJECT_ID}/usage`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /tenants/:id/usage', () => {
    it('rejects a malformed tenant id without ever calling aggregate', async () => {
      const res = await request(app)
        .get('/admin/api/tenants/not-an-object-id/usage')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(400);
      expect(usageEventAggregateMock).not.toHaveBeenCalled();
    });

    it('rejects an invalid from/to query', async () => {
      const res = await request(app)
        .get(`/admin/api/tenants/${VALID_OBJECT_ID}/usage?from=not-a-date`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(400);
    });

    it('aggregates by document_type x sri_estado, scoped to the tenant', async () => {
      usageEventAggregateMock.mockResolvedValueOnce([
        { _id: { document_type: '01', sri_estado: 'AUTORIZADO' }, count: 3 },
        { _id: { document_type: '01', sri_estado: 'PENDIENTE' }, count: 1 },
      ]);

      const res = await request(app)
        .get(`/admin/api/tenants/${VALID_OBJECT_ID}/usage`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { document_type: '01', sri_estado: 'AUTORIZADO', count: 3 },
        { document_type: '01', sri_estado: 'PENDIENTE', count: 1 },
      ]);

      const [pipeline] = usageEventAggregateMock.mock.calls[0];
      expect(pipeline[0].$match.empresa_emisora_id.toString()).toBe(VALID_OBJECT_ID);
    });

    it('applies from/to as a createdAt range in the aggregation match stage', async () => {
      const res = await request(app)
        .get(`/admin/api/tenants/${VALID_OBJECT_ID}/usage?from=2024-01-01&to=2024-12-31`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(200);
      const [pipeline] = usageEventAggregateMock.mock.calls[0];
      expect(pipeline[0].$match.createdAt.$gte).toBeInstanceOf(Date);
      expect(pipeline[0].$match.createdAt.$lte).toBeInstanceOf(Date);
    });
  });

  describe('GET /usage/summary', () => {
    it('aggregates totals per tenant across all tenants', async () => {
      usageEventAggregateMock.mockResolvedValueOnce([
        { _id: 'company-1', total: 10 },
        { _id: 'company-2', total: 4 },
      ]);

      const res = await request(app).get('/admin/api/usage/summary').set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { empresa_emisora_id: 'company-1', total: 10 },
        { empresa_emisora_id: 'company-2', total: 4 },
      ]);
    });

    it('rejects an invalid from/to query', async () => {
      const res = await request(app)
        .get('/admin/api/usage/summary?to=garbage')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(400);
    });
  });
});
