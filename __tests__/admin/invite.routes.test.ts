import request from 'supertest';
import jwt from 'jsonwebtoken';
import { hashInviteToken } from '../../src/utils/invite.utils';

function createInviteMock() {
  const statics = {
    find: jest.fn().mockReturnValue([]),
    findOneAndDelete: jest.fn().mockResolvedValue(null),
    saveMock: jest.fn().mockResolvedValue(undefined),
  };
  const saved: any[] = [];
  let nextId = 1;

  class MockModel {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      this._id = `invite-${nextId++}`;
      saved.push(this);
    }
    save = () => statics.saveMock(this);
    static find = (...args: any[]) => {
      const result: any = Promise.resolve(statics.find(...args));
      result.sort = () => result;
      return result;
    };
    static findOneAndDelete = (...args: any[]) => statics.findOneAndDelete(...args);
  }

  return { MockModel, statics, saved };
}

const inviteMock = createInviteMock();
jest.mock('../../src/models/Invite', () => ({
  __esModule: true,
  default: inviteMock.MockModel,
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

describe('Admin invite routes (/admin/api/tenants/:id/invites)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    inviteMock.saved.length = 0;
    inviteMock.statics.find.mockReturnValue([]);
    inviteMock.statics.findOneAndDelete.mockResolvedValue(null);
    inviteMock.statics.saveMock.mockResolvedValue(undefined);
    issuingCompanyFindByIdMock.mockResolvedValue({ _id: 'company-1' });
  });

  describe('adminAuth guard', () => {
    it('rejects requests with no token at all', async () => {
      const res = await request(app).get('/admin/api/tenants/company-1/invites');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /', () => {
    it('lists invites for the tenant (only ever holding token_hash, never the raw token)', async () => {
      inviteMock.statics.find.mockReturnValue([{ _id: 'invite-1', token_hash: 'abc123' }]);

      const res = await request(app)
        .get('/admin/api/tenants/company-1/invites')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ _id: 'invite-1', token_hash: 'abc123' }]);
    });
  });

  describe('POST /', () => {
    it('returns 404 when the tenant does not exist', async () => {
      issuingCompanyFindByIdMock.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/admin/api/tenants/does-not-exist/invites')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({});

      expect(res.status).toBe(404);
    });

    it('creates an invite: inv_ token, hashed at rest, 7-day expiry, and a ready-to-share onboarding URL', async () => {
      const res = await request(app)
        .post('/admin/api/tenants/company-1/invites')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.token).toMatch(/^inv_/);
      expect(res.body.onboarding_url).toBe(`${process.env.PUBLIC_URL}/onboarding?token=${res.body.token}`);

      expect(inviteMock.saved).toHaveLength(1);
      const stored = inviteMock.saved[0];
      expect(stored.empresa_emisora_id).toBe('company-1');
      expect(stored.created_by).toBe('admin-1');
      expect(stored.token_hash).toBe(hashInviteToken(res.body.token));
      // The raw token itself is never persisted, only its hash.
      expect(stored.token).toBeUndefined();

      const expiresAt = new Date(res.body.expires_at).getTime();
      const now = Date.now();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(expiresAt).toBeGreaterThan(now + sevenDaysMs - 5000);
      expect(expiresAt).toBeLessThan(now + sevenDaysMs + 5000);
    });
  });

  describe('DELETE /:inviteId', () => {
    it('returns 404 when the invite does not belong to this tenant (or does not exist)', async () => {
      const res = await request(app)
        .delete('/admin/api/tenants/company-1/invites/invite-999')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(404);
    });

    it('deletes the invite scoped to the tenant', async () => {
      inviteMock.statics.findOneAndDelete.mockResolvedValueOnce({ _id: 'invite-1' });

      const res = await request(app)
        .delete('/admin/api/tenants/company-1/invites/invite-1')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(200);
      expect(inviteMock.statics.findOneAndDelete).toHaveBeenCalledWith({
        _id: 'invite-1',
        empresa_emisora_id: 'company-1',
      });
    });
  });
});
