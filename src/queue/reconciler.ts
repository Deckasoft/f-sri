import { Queue, Worker } from 'bullmq';
import mongoose from 'mongoose';
import { getRedisConnection } from './connection';
import { enqueueAuthorizationCheck } from './queues';
import Invoice from '../models/Invoice';
import CreditNote from '../models/CreditNote';
import DebitNote from '../models/DebitNote';
import DeliveryNote from '../models/DeliveryNote';
import Withholding from '../models/Withholding';
import InvoicePDF from '../models/InvoicePDF';
import CreditNotePDF from '../models/CreditNotePDF';
import DebitNotePDF from '../models/DebitNotePDF';
import DeliveryNotePDF from '../models/DeliveryNotePDF';
import WithholdingPDF from '../models/WithholdingPDF';
import { enqueuePdfGeneration, enqueueInvoiceEmail } from './queues';
import type { DocumentType } from '../utils/sequence.utils';

export const RECONCILE_QUEUE = 'sri-reconcile';

/** How old a still-pending comprobante must be before it is re-enqueued. */
const STALE_AFTER_MS = 2 * 60 * 1000;
/** How often the sweep runs. */
const RECONCILE_EVERY_MS = 5 * 60 * 1000;

const NON_TERMINAL_STATES = ['PENDIENTE', 'RECIBIDA'];

const DOCUMENT_MODELS: ReadonlyArray<{
  documentType: DocumentType;
  model: mongoose.Model<any>;
  pdfModel: mongoose.Model<any>;
}> = [
  { documentType: '01', model: Invoice, pdfModel: InvoicePDF },
  { documentType: '04', model: CreditNote, pdfModel: CreditNotePDF },
  { documentType: '05', model: DebitNote, pdfModel: DebitNotePDF },
  { documentType: '06', model: DeliveryNote, pdfModel: DeliveryNotePDF },
  { documentType: '07', model: Withholding, pdfModel: WithholdingPDF },
];

/**
 * Re-enqueues every comprobante still awaiting authorization.
 *
 * This is what lets the queue be treated as an accelerator rather than the
 * source of truth: Mongo already records which documents sit in PENDIENTE or
 * RECIBIDA, so if Redis is wiped, restarted, or loses jobs, the next sweep
 * finds them again. Without it, a lost job means a comprobante nobody ever
 * asks the SRI about — no authorization, and (once the PDF and email move
 * behind AUTORIZADO) no RIDE and no email either.
 *
 * Enqueueing is idempotent by construction: the job id is derived from the
 * document, so re-enqueueing one that already has a pending job collapses
 * onto it instead of creating a second poller.
 */
export const reconcilePendingAuthorizations = async (now: number): Promise<number> => {
  // The document models carry no createdAt, but an ObjectId embeds its own
  // creation time, so the cutoff can be expressed as an id bound without
  // adding a field or an index.
  const cutoffId = mongoose.Types.ObjectId.createFromTime(Math.floor((now - STALE_AFTER_MS) / 1000));

  const counts = await Promise.all(
    DOCUMENT_MODELS.map(async ({ documentType, model }) => {
      const stuck = await model
        .find({ sri_estado: { $in: NON_TERMINAL_STATES }, _id: { $lt: cutoffId } }, { _id: 1 })
        .lean();

      await Promise.all(stuck.map((doc: any) => enqueueAuthorizationCheck(documentType, String(doc._id), 0)));
      return stuck.length;
    }),
  );

  return counts.reduce((total, n) => total + n, 0);
};

/**
 * Re-enqueues RIDE generation for comprobantes the SRI already authorized
 * but that have no PDF.
 *
 * The authorization sweep above does not cover these: it only looks at
 * PENDIENTE/RECIBIDA, so the moment a comprobante reaches AUTORIZADO it
 * falls outside that query. Without this, a PDF job that failed, exhausted
 * its retries, or was lost with Redis stranded the document permanently —
 * authorized, no RIDE, and nothing to notice. That is exactly what happened
 * when Chromium could not launch in an under-provisioned worker: the
 * comprobante was authorized correctly and the RIDE simply never existed.
 *
 * It is also what makes the claim "the queue is an accelerator, not the
 * source of truth" actually true for the whole pipeline rather than only
 * for authorization.
 */
export const reconcileMissingPdfs = async (now: number): Promise<number> => {
  const cutoffId = mongoose.Types.ObjectId.createFromTime(Math.floor((now - STALE_AFTER_MS) / 1000));

  const counts = await Promise.all(
    DOCUMENT_MODELS.map(async ({ documentType, model, pdfModel }) => {
      const authorized = await model
        .find({ sri_estado: 'AUTORIZADO', _id: { $lt: cutoffId } }, { _id: 1, clave_acceso: 1 })
        .lean();
      if (authorized.length === 0) {
        return 0;
      }

      // A row in estado 'ERROR' counts as missing on purpose: it records a
      // generation that failed, so the RIDE still does not exist.
      const generated = await pdfModel
        .find(
          { claveAcceso: { $in: authorized.map((d: any) => d.clave_acceso) }, estado: 'GENERADO' },
          { claveAcceso: 1 },
        )
        .lean();
      const have = new Set(generated.map((p: any) => p.claveAcceso));

      const missing = authorized.filter((d: any) => !have.has(d.clave_acceso));
      // force: the previous job for this document has already reached a
      // terminal state, and its id would otherwise swallow the re-enqueue.
      await Promise.all(missing.map((d: any) => enqueuePdfGeneration(documentType, String(d._id), { force: true })));
      return missing.length;
    }),
  );

  return counts.reduce((total, n) => total + n, 0);
};

/**
 * Re-enqueues emails for facturas whose RIDE exists but was never sent.
 *
 * Only NO_ENVIADO is swept, which is the model default and therefore means
 * "never attempted" — the lost-job case. ERROR is deliberately excluded: it
 * means the send was tried and failed (bad address, Resend rejecting), which
 * BullMQ has already retried and which needs a human, not an endless
 * five-minute redelivery loop.
 */
export const reconcileUnsentEmails = async (now: number): Promise<number> => {
  const cutoffId = mongoose.Types.ObjectId.createFromTime(Math.floor((now - STALE_AFTER_MS) / 1000));

  const unsent = await InvoicePDF.find(
    { estado: 'GENERADO', email_estado: 'NO_ENVIADO', _id: { $lt: cutoffId } },
    { claveAcceso: 1 },
  ).lean();

  // force, for the same reason as the RIDE sweep: a job that already failed
  // keeps its id and would swallow the re-enqueue.
  await Promise.all(unsent.map((pdf: any) => enqueueInvoiceEmail(pdf.claveAcceso, { force: true })));
  return unsent.length;
};

/**
 * Registers the repeatable sweep. Using a BullMQ repeatable job rather than
 * a setInterval means it survives a worker restart and does not multiply if
 * more than one worker process is running.
 */
export const scheduleReconciler = async (): Promise<void> => {
  const queue = new Queue(RECONCILE_QUEUE, { connection: getRedisConnection() });
  await queue.add(
    'sweep',
    {},
    {
      repeat: { every: RECONCILE_EVERY_MS },
      // A stable id keeps repeated deploys from stacking up schedules.
      jobId: 'sri-reconcile-sweep',
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    },
  );
  await queue.close();
};

export const createReconcilerWorker = (): Worker =>
  new Worker(
    RECONCILE_QUEUE,
    async () => {
      const now = Date.now();
      const authorizations = await reconcilePendingAuthorizations(now);
      const pdfs = await reconcileMissingPdfs(now);
      const emails = await reconcileUnsentEmails(now);

      if (authorizations > 0) {
        console.warn(`♻️  Reconciliador: ${authorizations} comprobante(s) sin autorizar re-encolados`);
      }
      if (pdfs > 0) {
        console.warn(`♻️  Reconciliador: ${pdfs} RIDE(s) faltantes re-encolados`);
      }
      if (emails > 0) {
        console.warn(`♻️  Reconciliador: ${emails} email(s) sin enviar re-encolados`);
      }
    },
    { connection: getRedisConnection(), concurrency: 1 },
  );
