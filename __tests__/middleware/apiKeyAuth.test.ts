import { Request, Response } from 'express';
import { hashApiKey } from '../../src/utils/apiKey.utils';

const apiKeyStaticMocks = {
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn().mockResolvedValue(null),
};

jest.mock('../../src/models/ApiKey', () => ({
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { apiKeyAuth } = require('../../src/middleware/apiKeyAuth');

const TOKEN = 'sk_live_test_token_1234567890';

const buildReq = (headers: Record<string, string> = {}): Request => ({ headers }) as unknown as Request;

const buildRes = (): Response => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

describe('apiKeyAuth middleware (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiKeyStaticMocks.findOne.mockResolvedValue({
      _id: 'api-key-1',
      revoked_at: undefined,
      last_used_at: undefined,
      empresa_emisora_id: { _id: 'company-1', active: true },
    });
  });

  it('rejects a request with no API key at all', async () => {
    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();

    await apiKeyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'API key requerida' });
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts the key via the X-API-Key header', async () => {
    const req = buildReq({ 'x-api-key': TOKEN });
    const res = buildRes();
    const next = jest.fn();

    await apiKeyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.auth).toEqual({ kind: 'apiKey', companyId: 'company-1', apiKeyId: 'api-key-1' });
    expect(apiKeyStaticMocks.findOne).toHaveBeenCalledWith({ key_hash: hashApiKey(TOKEN) });
  });

  it('accepts the key via Authorization: Bearer', async () => {
    const req = buildReq({ authorization: `Bearer ${TOKEN}` });
    const res = buildRes();
    const next = jest.fn();

    await apiKeyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.auth).toEqual({ kind: 'apiKey', companyId: 'company-1', apiKeyId: 'api-key-1' });
  });

  it('prefers the X-API-Key header over Authorization when both are present', async () => {
    const req = buildReq({ 'x-api-key': TOKEN, authorization: 'Bearer something-else' });
    const res = buildRes();
    const next = jest.fn();

    await apiKeyAuth(req, res, next);

    expect(apiKeyStaticMocks.findOne).toHaveBeenCalledWith({ key_hash: hashApiKey(TOKEN) });
    expect(next).toHaveBeenCalled();
  });

  it('rejects unknown API keys', async () => {
    apiKeyStaticMocks.findOne.mockResolvedValueOnce(null);
    const req = buildReq({ 'x-api-key': TOKEN });
    const res = buildRes();
    const next = jest.fn();

    await apiKeyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'API key inválida' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects revoked API keys', async () => {
    apiKeyStaticMocks.findOne.mockResolvedValueOnce({
      _id: 'api-key-1',
      revoked_at: new Date(),
      empresa_emisora_id: { _id: 'company-1', active: true },
    });
    const req = buildReq({ 'x-api-key': TOKEN });
    const res = buildRes();
    const next = jest.fn();

    await apiKeyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects keys whose company has been deactivated', async () => {
    apiKeyStaticMocks.findOne.mockResolvedValueOnce({
      _id: 'api-key-1',
      empresa_emisora_id: { _id: 'company-1', active: false },
    });
    const req = buildReq({ 'x-api-key': TOKEN });
    const res = buildRes();
    const next = jest.fn();

    await apiKeyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects keys whose company reference is missing (dangling ref)', async () => {
    apiKeyStaticMocks.findOne.mockResolvedValueOnce({
      _id: 'api-key-1',
      empresa_emisora_id: null,
    });
    const req = buildReq({ 'x-api-key': TOKEN });
    const res = buildRes();
    const next = jest.fn();

    await apiKeyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 500 when the lookup throws unexpectedly', async () => {
    apiKeyStaticMocks.findOne.mockRejectedValueOnce(new Error('mongo down'));
    const req = buildReq({ 'x-api-key': TOKEN });
    const res = buildRes();
    const next = jest.fn();

    await apiKeyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });

  it('touches last_used_at when it is stale (or unset)', async () => {
    const req = buildReq({ 'x-api-key': TOKEN });
    const res = buildRes();
    const next = jest.fn();

    await apiKeyAuth(req, res, next);
    // fire-and-forget: allow the microtask queue to flush
    await new Promise(process.nextTick);

    expect(apiKeyStaticMocks.findByIdAndUpdate).toHaveBeenCalledWith(
      'api-key-1',
      expect.objectContaining({ last_used_at: expect.any(Date) }),
    );
  });

  it('does not touch last_used_at when it was updated recently', async () => {
    apiKeyStaticMocks.findOne.mockResolvedValueOnce({
      _id: 'api-key-1',
      last_used_at: new Date(),
      empresa_emisora_id: { _id: 'company-1', active: true },
    });
    const req = buildReq({ 'x-api-key': TOKEN });
    const res = buildRes();
    const next = jest.fn();

    await apiKeyAuth(req, res, next);
    await new Promise(process.nextTick);

    expect(apiKeyStaticMocks.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});
