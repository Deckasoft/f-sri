import express from 'express';
import helmet from 'helmet';
import { loadEnv } from './config/env.config';
import { generalLimiter } from './config/rateLimit.config';
import authRoutes from './routes/auth';
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
import verifyToken from './middleware/verifyToken';

export const createApp = () => {
  // Mirrors index.ts: fail fast on missing/invalid env vars before wiring the app.
  loadEnv();

  const app = express();
  // Mirrors index.ts's helmet config (CSP off — see index.ts for why).
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json());
  app.use(authRoutes);
  app.use('/api/v1', generalLimiter);
  app.use(verifyToken);
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
  return app;
};
