import path from 'path';
import express from 'express';
import helmet from 'helmet';
import { loadEnv } from './config/env.config';
import { tenantLimiter } from './config/rateLimit.config';
import adminAuthRoutes from './routes/admin/auth';
import adminRoutes from './routes/admin';
import onboardingRoutes from './routes/onboarding';
import identificationTypeRoutes from './routes/identificationType';
import issuingCompanyRoutes from './routes/issuingCompany';
import clientRoutes from './routes/client';
import productRoutes from './routes/product';
import invoiceRoutes from './routes/invoice';
import creditNoteRoutes from './routes/creditNote';
import debitNoteRoutes from './routes/debitNote';
import deliveryNoteRoutes from './routes/deliveryNote';
import withholdingRoutes from './routes/withholding';
import invoiceDetailRoutes from './routes/invoiceDetail';
import invoicePDFRoutes from './routes/invoicePDF';
import { apiKeyAuth } from './middleware/apiKeyAuth';
import { adminAuth } from './middleware/adminAuth';
import { mountSpaFallback } from './staticSpa';

export interface CreateAppOptions {
  /**
   * Overrides the directory mountSpaFallback serves the SPA from. Test-only
   * escape hatch: __tests__/staticSpa.test.ts points this at a temp fixture
   * directory (built with fs.mkdtempSync) so it can assert the *real*
   * app.ts registration order — API routers registered before the SPA
   * fallback — actually holds even when the fallback has something to
   * serve, without depending on `admin/` having been built. Omitted (the
   * normal case, every other test file), this defaults to the same
   * `admin/dist` path src/index.ts uses, which is absent on a fresh
   * checkout/in CI, so mountSpaFallback no-ops exactly as it does in
   * production before the SPA is built.
   */
  adminDistDir?: string;
}

export const createApp = (options: CreateAppOptions = {}) => {
  // Mirrors index.ts: fail fast on missing/invalid env vars before wiring the app.
  loadEnv();

  const app = express();
  // Mirrors index.ts: trust the immediate reverse-proxy hop so req.ip
  // reflects the real caller (see the comment in index.ts for why `1`, not
  // `true`).
  app.set('trust proxy', 1);
  // Mirrors index.ts's helmet config (CSP off — see index.ts for why).
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json());
  // Mirrors index.ts: auth first, then the per-tenant limiter (see index.ts
  // for why the order matters).
  app.use('/api/v1', apiKeyAuth, tenantLimiter);
  app.use('/api/v1/identification-type', identificationTypeRoutes);
  app.use('/api/v1/issuing-company', issuingCompanyRoutes);
  app.use('/api/v1/client', clientRoutes);
  app.use('/api/v1/product', productRoutes);
  app.use('/api/v1/invoice', invoiceRoutes);
  app.use('/api/v1/credit-note', creditNoteRoutes);
  app.use('/api/v1/debit-note', debitNoteRoutes);
  app.use('/api/v1/delivery-note', deliveryNoteRoutes);
  app.use('/api/v1/withholding', withholdingRoutes);
  app.use('/api/v1/invoice-detail', invoiceDetailRoutes);
  app.use('/api/v1/invoice-pdf', invoicePDFRoutes);
  app.use('/onboarding/api', onboardingRoutes);
  app.use('/admin/api/auth', adminAuthRoutes);
  app.use('/admin/api', adminAuth);
  app.use('/admin/api', adminRoutes);

  // Mirrors index.ts: wires the same SPA-serving path-precedence logic into
  // the test app factory so it's exercised by the same code every other
  // route test runs against. In the normal test run (no adminDistDir
  // override) this is a deliberate no-op: admin/dist is gitignored Vite
  // build output, so mountSpaFallback(...) finds no index.html and mounts
  // nothing — the rest of the suite is unaffected either way. See
  // src/staticSpa.ts and __tests__/staticSpa.test.ts, which passes
  // adminDistDir pointed at a temp fixture to verify the registration order
  // below actually holds once the fallback has something to serve.
  const adminDistDir = options.adminDistDir ?? path.join(__dirname, '..', 'admin', 'dist');
  mountSpaFallback(app, '/admin', adminDistDir);
  mountSpaFallback(app, '/onboarding', adminDistDir);

  return app;
};
