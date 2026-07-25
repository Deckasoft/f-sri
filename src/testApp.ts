import path from 'path';
import express from 'express';
import helmet from 'helmet';
import { loadEnv } from './config/env.config';
import { generalLimiter } from './config/rateLimit.config';
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

export const createApp = () => {
  // Mirrors index.ts: fail fast on missing/invalid env vars before wiring the app.
  loadEnv();

  const app = express();
  // Mirrors index.ts's helmet config (CSP off — see index.ts for why).
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json());
  app.use('/api/v1', generalLimiter, apiKeyAuth);
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
  // route test runs against. This is a deliberate no-op in the normal test
  // run: admin/dist is gitignored Vite build output, so
  // mountSpaFallback(...) finds no index.html and mounts nothing — the 493
  // pre-existing tests are unaffected either way. See src/staticSpa.ts and
  // __tests__/staticSpa.test.ts (which builds a temp fixture dist/ to
  // exercise the fallback behavior directly, without depending on admin/
  // actually being built).
  const ADMIN_DIST_DIR = path.join(__dirname, '..', 'admin', 'dist');
  mountSpaFallback(app, '/admin', ADMIN_DIST_DIR);
  mountSpaFallback(app, '/onboarding', ADMIN_DIST_DIR);

  return app;
};
