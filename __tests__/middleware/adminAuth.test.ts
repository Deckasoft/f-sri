import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { adminAuth } from '../../src/middleware/adminAuth';

const buildReq = (headers: Record<string, string> = {}): Request => ({ headers }) as unknown as Request;

const buildRes = (): Response => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

describe('adminAuth middleware', () => {
  const JWT_SECRET = process.env.JWT_SECRET as string;

  it('rejects a request with no Authorization header', () => {
    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();

    adminAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Missing token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a malformed/invalid token', () => {
    const req = buildReq({ authorization: 'Bearer not-a-real-token' });
    const res = buildRes();
    const next = jest.fn();

    adminAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a validly-signed token that lacks role: admin', () => {
    const token = jwt.sign({ userId: 'user-1', role: 'not-admin' }, JWT_SECRET, { expiresIn: '4d' });
    const req = buildReq({ authorization: `Bearer ${token}` });
    const res = buildRes();
    const next = jest.fn();

    adminAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a validly-signed token missing userId', () => {
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '4d' });
    const req = buildReq({ authorization: `Bearer ${token}` });
    const res = buildRes();
    const next = jest.fn();

    adminAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a valid admin token and populates req.auth', () => {
    const token = jwt.sign({ userId: 'user-1', role: 'admin' }, JWT_SECRET, { expiresIn: '4d' });
    const req = buildReq({ authorization: `Bearer ${token}` });
    const res = buildRes();
    const next = jest.fn();

    adminAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.auth).toEqual({ kind: 'admin', userId: 'user-1' });
  });

  it('rejects a token signed with a different secret', () => {
    const token = jwt.sign({ userId: 'user-1', role: 'admin' }, 'a-different-secret', { expiresIn: '4d' });
    const req = buildReq({ authorization: `Bearer ${token}` });
    const res = buildRes();
    const next = jest.fn();

    adminAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
