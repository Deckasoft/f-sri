import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

import { loadEnv } from './config/env.config';

// Fail fast: validate required environment variables before anything else
// (including modules imported below that read process.env eagerly, such as
// encryption.utils.ts) has a chance to run with missing/invalid config.
loadEnv();

import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import { getCorsConfig } from './config/cors.config';
import { tenantLimiter } from './config/rateLimit.config';
import swaggerSpec from './swagger';
import { PDFStorageFactory } from './services/storage';
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
import corsErrorHandler from './middleware/corsErrorHandler';
import { mountSpaFallback } from './staticSpa';

const app = express();

// This API is only ever reached through the Caddy reverse proxy defined in
// Caddyfile (compose.prod.yml — `caddy` -> `api:3000` on an internal Docker
// network), so req.ip/req.ips must be resolved from the X-Forwarded-For
// header Caddy sets, not from the proxy's own connection address. Without
// this, every request from every tenant appears to originate from the same
// container IP. `1` (not `true`) trusts exactly the immediate hop (Caddy) —
// `true` trusts the entire X-Forwarded-For chain, which express-rate-limit
// refuses to start under (ERR_ERL_PERMISSIVE_TRUST_PROXY) because it would
// let a caller spoof its own rate-limit key via the header.
app.set('trust proxy', 1);

// Cabeceras de seguridad HTTP (helmet). CSP se desactiva porque /docs sirve
// Swagger UI desde un CDN externo (unpkg.com); el CSP por defecto de helmet
// (default-src 'self') bloquearía esos scripts en el navegador.
app.use(helmet({ contentSecurityPolicy: false }));

// Configurar CORS
const corsConfig = getCorsConfig();
app.use(cors(corsConfig));

// Middleware adicional para headers de CORS
app.use((req, res, next) => {
  // Headers adicionales de seguridad
  res.header('Access-Control-Allow-Credentials', 'true');

  // Para peticiones OPTIONS (preflight)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  next();
});

// Middleware para parsear JSON
app.use(express.json());

const swaggerHtml = `<!DOCTYPE html>
<html>
<head>
  <title>API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@4.18.3/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@4.18.3/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({ url: '/swagger.json', dom_id: '#swagger-ui' });
    };
  </script>
</body>
</html>`;

// Public routes for documentation
app.get('/swagger.json', (_req, res) => {
  res.json(swaggerSpec);
});

app.get('/docs', (_req, res) => {
  res.type('html').send(swaggerHtml);
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    cors: 'enabled',
    environment: process.env.NODE_ENV || 'development',
  });
});

// Per-tenant API key auth, THEN the per-tenant rate limiter for the
// invoicing API. Order matters: tenantLimiter keys its bucket off
// req.auth.companyId (see src/config/rateLimit.config.ts), which apiKeyAuth
// populates — running the limiter first would mean either keying on IP
// (wrong behind the Caddy reverse proxy, see H-1 in the whole-branch review)
// or having no tenant to key on yet.
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

// Public, unauthenticated onboarding flow (invite redemption). Rate-limited
// internally (onboardingLimiter, IP-keyed) since it's another public,
// auth-adjacent surface — deliberately its own bucket, separate from the
// admin login limiter below, so a burst of onboarding traffic can't lock out
// operator login (see H-1 in the whole-branch review).
app.use('/onboarding/api', onboardingRoutes);

// Admin backoffice API (Phase 4 builds on this). Login is public; the
// adminAuth guard registered below it protects everything mounted after.
app.use('/admin/api/auth', adminAuthRoutes);
app.use('/admin/api', adminAuth);
app.use('/admin/api', adminRoutes);

// Backoffice SPA (Phase 6, admin/): the SAME built bundle is served at both
// /admin (backoffice dashboard) and /onboarding (public onboarding page) —
// its client-side router handles both path spaces from one Vite build. Must
// be mounted AFTER the API routers above so /admin/api/* and
// /onboarding/api/* keep taking precedence; see src/staticSpa.ts for why
// that ordering is sufficient and what the extra safety check there covers.
// No-ops if admin/dist hasn't been built (gitignored output) — see
// src/staticSpa.ts's doc comment.
const ADMIN_DIST_DIR = path.join(__dirname, '..', 'admin', 'dist');
mountSpaFallback(app, '/admin', ADMIN_DIST_DIR);
mountSpaFallback(app, '/onboarding', ADMIN_DIST_DIR);

// Error handling middleware (debe ir al final)
app.use(corsErrorHandler);

// Middleware de manejo general de errores
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});

const PORT = process.env.PORT || 3000;
const { MONGO_URI } = loadEnv();

// Construct the storage provider once at startup so a misconfiguration is a
// boot failure rather than a per-document surprise. Previously S3's config
// was only validated lazily, inside the constructor, on the first upload --
// which happens inside the PDF worker's try/catch, so bad config surfaced as
// InvoicePDF rows with estado 'ERROR' that no API response ever mentioned.
// This also warms the singleton the request path reuses.
PDFStorageFactory.create();

mongoose
  .connect(MONGO_URI)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`📄 API Docs: http://localhost:${PORT}/docs`);
    });
  })
  .catch((err) => {
    // Fail loudly and exit rather than leaving the process alive-but-deaf:
    // without this, an unreachable MONGO_URI (e.g. the VPS's IP not yet
    // allowlisted in MongoDB Atlas — the single most likely first-deploy
    // mistake) would leave the process running with app.listen() never
    // called, so it never binds the port and never crashes. That silently
    // defeats `restart: always` in compose.prod.yml (nothing crashes, so
    // nothing restarts) and looks from the outside like a Caddy/upstream
    // problem rather than a database one. Exiting lets the container
    // orchestrator's restart policy actually retry the connection.
    console.error('❌ Database connection error', err);
    process.exit(1);
  });
