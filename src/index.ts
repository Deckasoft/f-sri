import dotenv from 'dotenv';

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
import { generalLimiter } from './config/rateLimit.config';
import swaggerSpec from './swagger';
import corsTestRoutes from './routes/cors-test';
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

const app = express();

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

app.use(corsTestRoutes);

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

// General rate limiter + per-tenant API key auth for the invoicing API
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

// Public, unauthenticated onboarding flow (invite redemption). Rate-limited
// internally (authLimiter) since it's another public, auth-adjacent surface,
// same category as the admin login route below.
app.use('/onboarding/api', onboardingRoutes);

// Admin backoffice API (Phase 4 builds on this). Login is public; the
// adminAuth guard registered below it protects everything mounted after.
app.use('/admin/api/auth', adminAuthRoutes);
app.use('/admin/api', adminAuth);
app.use('/admin/api', adminRoutes);

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
    console.error('❌ Database connection error', err);
  });
