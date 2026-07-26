import request from 'supertest';
import { hashInviteToken } from '../src/utils/invite.utils';

// --- Invite mock ---
const inviteStaticMocks = {
  findOne: jest.fn().mockResolvedValue(null),
  findOneAndUpdate: jest.fn().mockResolvedValue(null),
};
jest.mock('../src/models/Invite', () => ({
  __esModule: true,
  default: {
    findOne: (...args: any[]) => inviteStaticMocks.findOne(...args),
    findOneAndUpdate: (...args: any[]) => inviteStaticMocks.findOneAndUpdate(...args),
  },
}));

// --- IssuingCompany mock ---
const issuingCompanyStaticMocks = {
  findById: jest.fn().mockResolvedValue(null),
  findOneAndUpdate: jest.fn().mockResolvedValue(null),
};
jest.mock('../src/models/IssuingCompany', () => ({
  __esModule: true,
  default: {
    findById: (...args: any[]) => issuingCompanyStaticMocks.findById(...args),
    findOneAndUpdate: (...args: any[]) => issuingCompanyStaticMocks.findOneAndUpdate(...args),
  },
}));

// --- ApiKey mock ---
const savedApiKeys: any[] = [];
class MockApiKey {
  [key: string]: any;
  constructor(data: Record<string, unknown>) {
    Object.assign(this, data);
    this._id = `api-key-${savedApiKeys.length + 1}`;
    savedApiKeys.push(this);
  }
  save = jest.fn().mockResolvedValue(this);
}
jest.mock('../src/models/ApiKey', () => ({ __esModule: true, default: MockApiKey }));

// --- certificate.utils mock: control P12 verification outcome without a real P12 file ---
const verifyP12PasswordMock = jest.fn();
jest.mock('../src/utils/certificate.utils', () => ({
  __esModule: true,
  verifyP12Password: (...args: any[]) => verifyP12PasswordMock(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createApp } = require('../src/testApp');
const app = createApp();

const VALID_TOKEN = 'inv_validTokenForTesting1234567890';
const VALID_TOKEN_HASH = hashInviteToken(VALID_TOKEN);

const company = {
  _id: 'company-1',
  ruc: '1790012345001',
  razon_social: 'EMPRESA DEMO S.A.',
  nombre_comercial: 'EMPRESA DEMO',
};

describe('Public onboarding routes (/onboarding/api)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    savedApiKeys.length = 0;
    inviteStaticMocks.findOne.mockResolvedValue(null);
    inviteStaticMocks.findOneAndUpdate.mockResolvedValue(null);
    issuingCompanyStaticMocks.findById.mockResolvedValue(null);
    issuingCompanyStaticMocks.findOneAndUpdate.mockResolvedValue(null);
    verifyP12PasswordMock.mockResolvedValue({ valid: true });
  });

  describe('GET /invite/:token', () => {
    it('reports not_found for an unknown token', async () => {
      const res = await request(app).get('/onboarding/api/invite/inv_doesNotExist');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ valid: false, reason: 'not_found' });
    });

    it('reports used for an already-redeemed invite', async () => {
      inviteStaticMocks.findOne.mockResolvedValueOnce({
        token_hash: VALID_TOKEN_HASH,
        used_at: new Date(),
        expires_at: new Date(Date.now() + 1000 * 60 * 60),
        empresa_emisora_id: 'company-1',
      });

      const res = await request(app).get(`/onboarding/api/invite/${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ valid: false, reason: 'used' });
    });

    it('reports expired for a past-expiry invite', async () => {
      inviteStaticMocks.findOne.mockResolvedValueOnce({
        token_hash: VALID_TOKEN_HASH,
        used_at: undefined,
        expires_at: new Date(Date.now() - 1000),
        empresa_emisora_id: 'company-1',
      });

      const res = await request(app).get(`/onboarding/api/invite/${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ valid: false, reason: 'expired' });
    });

    it('returns valid: true with a masked RUC (never the full RUC) for a live invite', async () => {
      inviteStaticMocks.findOne.mockResolvedValueOnce({
        token_hash: VALID_TOKEN_HASH,
        used_at: undefined,
        expires_at: new Date(Date.now() + 1000 * 60 * 60),
        empresa_emisora_id: 'company-1',
      });
      issuingCompanyStaticMocks.findById.mockResolvedValueOnce(company);

      const res = await request(app).get(`/onboarding/api/invite/${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.company.razon_social).toBe(company.razon_social);
      expect(res.body.company.ruc).not.toBe(company.ruc);
      // Never the raw RUC, and only the last 4 digits visible.
      expect(res.body.company.ruc.slice(-4)).toBe(company.ruc.slice(-4));
      expect(res.body.company.ruc.slice(0, -4)).toMatch(/^\*+$/);
    });
  });

  describe('POST /complete', () => {
    const validBody = () => ({
      token: VALID_TOKEN,
      certificate: Buffer.from('fake-p12-bytes').toString('base64'),
      certificate_password: 'super-secret',
    });

    it('rejects a malformed body', async () => {
      const res = await request(app).post('/onboarding/api/complete').send({ token: VALID_TOKEN });
      expect(res.status).toBe(400);
      expect(inviteStaticMocks.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects (400) when the P12 does not open with the given password, WITHOUT consuming the invite', async () => {
      verifyP12PasswordMock.mockResolvedValueOnce({ valid: false, error: 'wrong password' });

      const res = await request(app).post('/onboarding/api/complete').send(validBody());

      expect(res.status).toBe(400);
      // The invite must not be burned on a bad certificate password.
      expect(inviteStaticMocks.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects (400) an invalid, expired, or already-used invite token', async () => {
      inviteStaticMocks.findOneAndUpdate.mockResolvedValueOnce(null);

      const res = await request(app).post('/onboarding/api/complete').send(validBody());

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid|expired|used/i);
      expect(issuingCompanyStaticMocks.findOneAndUpdate).not.toHaveBeenCalled();
      expect(savedApiKeys).toHaveLength(0);
    });

    it('atomically consumes the invite using { token_hash, used_at: null, expires_at: $gt now }', async () => {
      inviteStaticMocks.findOneAndUpdate.mockResolvedValueOnce({
        _id: 'invite-1',
        empresa_emisora_id: 'company-1',
      });
      issuingCompanyStaticMocks.findOneAndUpdate.mockResolvedValueOnce(company);

      await request(app).post('/onboarding/api/complete').send(validBody());

      const [filterArg, updateArg] = inviteStaticMocks.findOneAndUpdate.mock.calls[0];
      expect(filterArg.token_hash).toBe(hashInviteToken(VALID_TOKEN));
      expect(filterArg.used_at).toBeNull();
      expect(filterArg.expires_at.$gt).toBeInstanceOf(Date);
      expect(updateArg.used_at).toBeInstanceOf(Date);
    });

    it('happy path: stores the certificate encrypted, sets onboarded_at, and returns a fresh API key exactly once', async () => {
      inviteStaticMocks.findOneAndUpdate.mockResolvedValueOnce({
        _id: 'invite-1',
        empresa_emisora_id: 'company-1',
      });
      issuingCompanyStaticMocks.findOneAndUpdate.mockResolvedValueOnce(company);

      const res = await request(app).post('/onboarding/api/complete').send(validBody());

      expect(res.status).toBe(201);
      expect(res.body.api_key).toMatch(/^sk_live_/);
      expect(res.body.company).toEqual({
        id: company._id,
        razon_social: company.razon_social,
        nombre_comercial: company.nombre_comercial,
        ruc: company.ruc,
      });

      const [filterArg, updatePayload, options] = issuingCompanyStaticMocks.findOneAndUpdate.mock.calls[0];
      // Existence + active check and the certificate write happen as ONE
      // atomic operation (see L-5 in the whole-branch review): a suspended
      // tenant must not be able to overwrite its certificate via a
      // still-live invite.
      expect(filterArg).toEqual({ _id: 'company-1', active: true });
      expect(updatePayload.certificate).not.toBe(validBody().certificate);
      expect(updatePayload.certificate_password).not.toBe('super-secret');
      expect(updatePayload.onboarded_at).toBeInstanceOf(Date);
      expect(options).toEqual({ new: true });

      expect(savedApiKeys).toHaveLength(1);
      expect(savedApiKeys[0].empresa_emisora_id).toBe(company._id);
      expect(savedApiKeys[0].key_hash).not.toBe(res.body.api_key);
    });

    it('maps an optional contact_email onto email_notificacion', async () => {
      inviteStaticMocks.findOneAndUpdate.mockResolvedValueOnce({
        _id: 'invite-1',
        empresa_emisora_id: 'company-1',
      });
      issuingCompanyStaticMocks.findOneAndUpdate.mockResolvedValueOnce(company);

      await request(app)
        .post('/onboarding/api/complete')
        .send({ ...validBody(), contact_email: 'ops@empresademo.com' });

      const [, updatePayload] = issuingCompanyStaticMocks.findOneAndUpdate.mock.calls[0];
      expect(updatePayload.email_notificacion).toBe('ops@empresademo.com');
    });

    it('returns 404 when the invite points at a tenant that no longer exists', async () => {
      inviteStaticMocks.findOneAndUpdate.mockResolvedValueOnce({
        _id: 'invite-1',
        empresa_emisora_id: 'ghost-company',
      });
      issuingCompanyStaticMocks.findOneAndUpdate.mockResolvedValueOnce(null);
      issuingCompanyStaticMocks.findById.mockResolvedValueOnce(null);

      const res = await request(app).post('/onboarding/api/complete').send(validBody());

      expect(res.status).toBe(404);
      expect(savedApiKeys).toHaveLength(0);
    });

    it('returns 403 and writes nothing when the invite points at a SUSPENDED tenant', async () => {
      inviteStaticMocks.findOneAndUpdate.mockResolvedValueOnce({
        _id: 'invite-1',
        empresa_emisora_id: 'company-1',
      });
      // The { active: true } filter excludes a suspended tenant, so the
      // conditional update matches nothing.
      issuingCompanyStaticMocks.findOneAndUpdate.mockResolvedValueOnce(null);
      // The follow-up read-only lookup (for the error message only) finds
      // the tenant, but inactive.
      issuingCompanyStaticMocks.findById.mockResolvedValueOnce({ ...company, active: false });

      const res = await request(app).post('/onboarding/api/complete').send(validBody());

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/suspend/i);
      expect(savedApiKeys).toHaveLength(0);
    });
  });
});
