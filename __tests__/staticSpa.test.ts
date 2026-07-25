import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { mountSpaFallback } from '../src/staticSpa';

// Mocked so the second describe block's real-app requests (createApp() from
// src/testApp.ts) resolve without a live Mongo connection — this suite is
// about static-serving/API path precedence, not model behavior, following
// the same hand-rolled mock convention as __tests__/admin/tenant.routes.test.ts
// and __tests__/onboarding.routes.test.ts.
const issuingCompanyStaticMocks = {
  find: jest.fn().mockReturnValue([]),
};
jest.mock('../src/models/IssuingCompany', () => ({
  __esModule: true,
  default: {
    find: (...args: any[]) => {
      const result: any = Promise.resolve(issuingCompanyStaticMocks.find(...args));
      result.sort = () => result;
      return result;
    },
  },
}));

const inviteStaticMocks = {
  findOne: jest.fn().mockResolvedValue(null),
};
jest.mock('../src/models/Invite', () => ({
  __esModule: true,
  default: {
    findOne: (...args: any[]) => inviteStaticMocks.findOne(...args),
  },
}));

describe('mountSpaFallback', () => {
  let distDir: string;

  beforeEach(() => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f-sri-spa-test-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>SPA</title><body>spa-shell</body>');
    fs.writeFileSync(path.join(distDir, 'style.css'), 'body { color: red; }');
  });

  afterEach(() => {
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  it('no-ops (mounts nothing, returns false) when index.html does not exist', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f-sri-spa-empty-'));
    try {
      const app = express();
      const mounted = mountSpaFallback(app, '/admin', emptyDir);
      expect(mounted).toBe(false);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('returns true and serves the SPA shell for a non-api path under the mount', async () => {
    const app = express();
    const mounted = mountSpaFallback(app, '/admin', distDir);
    expect(mounted).toBe(true);

    const res = await request(app).get('/admin/tenants/123');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('spa-shell');
  });

  it('serves the SPA shell at the bare mount path (no trailing segment)', async () => {
    const app = express();
    mountSpaFallback(app, '/admin', distDir);

    const res = await request(app).get('/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('spa-shell');
  });

  it('serves static assets (e.g. built CSS/JS) from the dist directory', async () => {
    const app = express();
    mountSpaFallback(app, '/admin', distDir);

    const res = await request(app).get('/admin/style.css');
    expect(res.status).toBe(200);
    expect(res.text).toContain('color: red');
  });

  it('does NOT shadow an API route registered before it at the same prefix', async () => {
    const app = express();
    // Simulates src/index.ts's real ordering: an API router (here, a stand-in
    // for adminAuth's 401) is registered BEFORE the SPA fallback.
    app.get('/admin/api/tenants', (_req, res) => {
      res.status(401).json({ message: 'Missing token' });
    });
    mountSpaFallback(app, '/admin', distDir);

    const res = await request(app).get('/admin/api/tenants');
    expect(res.status).toBe(401);
    expect(res.type).toBe('application/json');
    expect(res.body).toEqual({ message: 'Missing token' });
  });

  it('does not serve the SPA shell for an unmatched /api sub-path under the mount', async () => {
    const app = express();
    mountSpaFallback(app, '/admin', distDir);
    // No handler for this exact API sub-path registered before the fallback
    // — Express's default 404 should apply, not the SPA's index.html.
    const res = await request(app).get('/admin/api/nonexistent-route');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('spa-shell');
  });

  it('serves the same dist directory correctly at a second mount path (e.g. /onboarding)', async () => {
    const app = express();
    mountSpaFallback(app, '/admin', distDir);
    mountSpaFallback(app, '/onboarding', distDir);

    const res = await request(app).get('/onboarding?token=abc123');
    expect(res.status).toBe(200);
    expect(res.text).toContain('spa-shell');
  });
});

describe('SPA static serving does not shadow real API routes (src/testApp.ts wiring)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createApp } = require('../src/testApp');
  const app = createApp();

  it('GET /admin/api/tenants still hits the admin API and returns 401 JSON without a token', async () => {
    const res = await request(app).get('/admin/api/tenants');
    expect(res.status).toBe(401);
    expect(res.type).toBe('application/json');
  });

  it('GET /admin/api/tenants returns JSON (not the SPA shell) with a valid admin JWT too', async () => {
    const token = jwt.sign({ userId: 'admin-1', role: 'admin' }, process.env.JWT_SECRET as string, {
      expiresIn: '4d',
    });
    const res = await request(app).get('/admin/api/tenants').set('Authorization', `Bearer ${token}`);
    // No Mongo connection in this suite — what matters is that the response
    // is JSON from the API layer, not HTML from a static/SPA fallback.
    expect(res.type).toBe('application/json');
  });

  it('GET /onboarding/api/invite/:token still hits the onboarding API (JSON, not HTML)', async () => {
    const res = await request(app).get('/onboarding/api/invite/some-bogus-token');
    expect(res.type).toBe('application/json');
  });
});
