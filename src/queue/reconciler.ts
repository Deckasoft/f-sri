import { Queue, Worker } from 'bullmq';
import mongoose from 'mongoose';
import { getRedisConnection } from './connection';
import { enqueueAuthorizationCheck } from './queues';
import Invoice from '../models/Invoice';
import CreditNote from '../models/CreditNote';
import DebitNote from '../models/DebitNote';
import DeliveryNote from '../models/DeliveryNote';
import Withholding from '../models/Withholding';
import type { DocumentType } from '../utils/sequence.utils';

export const RECONCILE_QUEUE = 'sri-reconcile';

/** How old a still-pending comprobante must be before it is re-enqueued. */
const STALE_AFTER_MS = 2 * 60 * 1000;
/** How often the sweep runs. */
const RECONCILE_EVERY_MS = 5 * 60 * 1000;

const NON_TERMINAL_STATES = ['PENDIENTE', 'RECIBIDA'];

const DOCUMENT_MODELS: ReadonlyArray<{ documentType: DocumentType; model: mongoose.Model<any> }> = [
  { documentType: '01', model: Invoice },
  { documentType: '04', model: CreditNote },
  { documentType: '05', model: DebitNote },
  { documentType: '06', model: DeliveryNote },
  { documentType: '07', model: Withholding },
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
      const requeued = await reconcilePendingAuthorizations(Date.now());
      if (requeued > 0) {
        console.warn(`♻️  Reconciliador: ${requeued} comprobante(s) pendientes re-encolados`);
      }
    },
    { connection: getRedisConnection(), concurrency: 1 },
  );
