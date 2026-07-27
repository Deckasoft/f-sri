import dotenv from 'dotenv';

dotenv.config();

import mongoose from 'mongoose';
import { loadEnv } from './config/env.config';
import { createAuthorizationWorker } from './queue/workers/authorization.worker';
import { createPdfWorker } from './queue/workers/pdf.worker';
import { createEmailWorker } from './queue/workers/email.worker';
import { createReconcilerWorker, scheduleReconciler, runReconcileSweepOnStartup } from './queue/reconciler';
import { closeQueues } from './queue/queues';
import { closeRedisConnection } from './queue/connection';

/**
 * Background worker process.
 *
 * Runs as a SEPARATE container from the API, sharing the same image with a
 * different command. Keeping it out of the API process is the point: the
 * work it does (polling the SRI for authorization, and later generating PDFs)
 * used to live in unref()'d setTimeouts inside the web process, so a deploy
 * or a crash silently dropped everything in flight and nothing ever picked
 * it back up.
 */
const start = async (): Promise<void> => {
  const { MONGO_URI } = loadEnv();

  await mongoose.connect(MONGO_URI);
  console.warn('✅ Worker conectado a MongoDB');

  const authorizationWorker = createAuthorizationWorker();
  const pdfWorker = createPdfWorker();
  const emailWorker = createEmailWorker();
  const reconcilerWorker = createReconcilerWorker();
  await scheduleReconciler();

  console.warn('✅ Worker escuchando: autorización SRI + RIDE + email + reconciliador');

  // After the workers exist, so anything this queues is picked up immediately
  // rather than sitting until the first repeatable run. Not awaited before the
  // listeners below are attached, but awaited here so startup logs stay in a
  // sensible order.
  await runReconcileSweepOnStartup();

  pdfWorker.on('failed', (job, err) => {
    console.error(`❌ Generación de RIDE falló para ${job?.id}: ${err.message}`);
  });

  emailWorker.on('failed', (job, err) => {
    console.error(`❌ Envío de email falló para ${job?.id}: ${err.message}`);
  });

  authorizationWorker.on('failed', (job, err) => {
    // A failure here is usually just "not authorized yet" -- the job will be
    // retried with backoff. It only becomes interesting once attempts run out.
    const attempts = job?.opts.attempts ?? 0;
    if (job && job.attemptsMade >= attempts) {
      console.error(`❌ Autorización agotó reintentos para ${job.id}: ${err.message}`);
    }
  });

  reconcilerWorker.on('failed', (_job, err) => {
    console.error('❌ El reconciliador falló:', err.message);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.warn(`\n${signal} recibido, cerrando worker…`);
    // Close the workers first so in-flight jobs finish and are not lost, then
    // release the producers and the shared connection.
    await Promise.all([authorizationWorker.close(), pdfWorker.close(), emailWorker.close(), reconcilerWorker.close()]);
    await closeQueues();
    await closeRedisConnection();
    await mongoose.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
};

start().catch((err: unknown) => {
  console.error('❌ El worker no pudo arrancar:', err);
  process.exit(1);
});
