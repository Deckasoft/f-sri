import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/testApp';

// --- User mock ---
const userStaticMocks = {
  findOne: jest.fn().mockResolvedValue(null),
};
jest.mock('../../src/models/User', () => ({
  __esModule: true,
  default: {
    findOne: (...args: any[]) => userStaticMocks.findOne(...args),
  },
}));

const app = createApp();

describe('POST /admin/api/auth/login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a request missing email or password', async () => {
    let res = await request(app).post('/admin/api/auth/login').send({});
    expect(res.status).toBe(400);

    res = await request(app).post('/admin/api/auth/login').send({ email: 'a@b.com' });
    expect(res.status).toBe(400);
  });

  it('rejects unknown emails', async () => {
    userStaticMocks.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/admin/api/auth/login')
      .send({ email: 'nadie@test.com', password: 'whatever' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Credenciales inválidas');
  });

  it('rejects an incorrect password', async () => {
    const hashedPassword = await bcrypt.hash('correct-password', 10);
    userStaticMocks.findOne.mockResolvedValueOnce({
      _id: 'user-1',
      email: 'admin@test.com',
      password: hashedPassword,
      role: 'admin',
    });

    const res = await request(app)
      .post('/admin/api/auth/login')
      .send({ email: 'admin@test.com', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Credenciales inválidas');
  });

  it('logs in successfully and issues a JWT with { userId, role }', async () => {
    const hashedPassword = await bcrypt.hash('correct-password', 10);
    userStaticMocks.findOne.mockResolvedValueOnce({
      _id: 'user-1',
      email: 'admin@test.com',
      password: hashedPassword,
      role: 'admin',
    });

    const res = await request(app)
      .post('/admin/api/auth/login')
      .send({ email: 'admin@test.com', password: 'correct-password' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toEqual({ id: 'user-1', email: 'admin@test.com', role: 'admin' });

    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET as string);
    expect(decoded).toMatchObject({ userId: 'user-1', role: 'admin' });
  });
});

describe('adminAuth guard on /admin/api/*', () => {
  it('requires a valid admin token for any other /admin/api route (Phase 4 routers mount behind this)', async () => {
    const res = await request(app).get('/admin/api/whatever-phase-4-adds');
    expect(res.status).toBe(401);
  });
});
