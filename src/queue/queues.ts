import { Queue, type JobsOptions } from 'bullmq';
import { getRedisConnection } from './connection';
import type { DocumentType } from '../utils/sequence.utils';

export const AUTHORIZATION_QUEUE = 'sri-authorization';
export const PDF_QUEUE = 'sri-pdf';
export const EMAIL_QUEUE = 'sri-email';

/** Payload of every authorization-check job. */
export type AuthorizationJob = {
  documentType: DocumentType;
  documentId: string;
};

/** Payload of every RIDE-generation job. */
export type PdfJob = {
  documentType: DocumentType;
  documentId: string;
};

/** Payload of every invoice-email job. */
export type EmailJob = {
  claveAcceso: string;
};

/**
 * Queue instances are created on first use, never at import time — see the
 * note in ./connection.ts. Holding them in a map also means the app process
 * and the worker process each keep exactly one producer per queue.
 */
const queues = new Map<string, Queue>();

const getQueue = (name: string): Queue => {
  const existing = queues.get(name);
  if (existing) {
    return existing;
  }
  const queue = new Queue(name, { connection: getRedisConnection() });
  queues.set(name, queue);
  return queue;
};

/**
 * In the SRI's offline scheme, recepción and autorización are separate steps:
 * a comprobante is accepted for processing first and authorized seconds (or
 * longer) later, so it has to be polled for.
 *
 * The job id is derived from the document, so re-enqueueing the same document
 * — which the reconciler does routinely — collapses onto the existing job
 * instead of spawning a second poller for it.
 *
 * Retries use exponential backoff rather than a fixed 3-attempt budget. The
 * previous in-memory implementation gave a document ~15 seconds total, once,
 * in an unref()'d setTimeout; anything slower than that was abandoned in
 * PENDIENTE forever, and a deploy silently dropped every pending check.
 */
const AUTHORIZATION_JOB_OPTIONS: JobsOptions = {
  attempts: 10,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  // Kept deliberately: a job that exhausted its attempts is a document stuck
  // in PENDIENTE, which someone needs to be able to see.
  removeOnFail: false,
};

/**
 * NOT separated by ':' — BullMQ rejects a custom job id containing one
 * ("Custom Id cannot contain :"), because it composes its own Redis keys
 * with that separator. Every enqueue would throw at runtime.
 */
export const authorizationJobId = (documentType: DocumentType, documentId: string): string =>
  `${documentType}-${documentId}`;

export const enqueueAuthorizationCheck = async (
  documentType: DocumentType,
  documentId: string,
  delayMs = 5_000,
): Promise<void> => {
  await getQueue(AUTHORIZATION_QUEUE).add('check', { documentType, documentId } satisfies AuthorizationJob, {
    ...AUTHORIZATION_JOB_OPTIONS,
    delay: delayMs,
    jobId: authorizationJobId(documentType, documentId),
  });
};

/**
 * Enqueued once the SRI has AUTHORIZED a comprobante — never before.
 *
 * The RIDE used to be generated on recepción, one step earlier, which meant
 * it was stamped with a placeholder authorization date (the recepción
 * timestamp) and could be produced for a comprobante the SRI went on to
 * reject. Nothing regenerated it when the real authorization arrived.
 */
export const enqueuePdfGeneration = async (
  documentType: DocumentType,
  documentId: string,
  { force = false }: { force?: boolean } = {},
): Promise<void> => {
  const queue = getQueue(PDF_QUEUE);
  const jobId = `${documentType}-${documentId}`;

  // Job ids are deduplicated, and BullMQ counts a job that has already reached
  // a terminal state as existing: adding the same id again is silently
  // ignored, returning the old job. That is what we want on the normal path
  // (an authorization checked twice must not render the RIDE twice), but it
  // makes recovery impossible -- the reconciler could never re-run a job that
  // had already completed or failed.
  //
  // `force` is the recovery path: drop the stale job first so the new one is
  // really queued. The reconciler has already established from the database
  // that the RIDE is genuinely missing, so this cannot cause duplicate work.
  if (force) {
    await queue.remove(jobId).catch(() => undefined);
  }

  await queue.add('generate', { documentType, documentId } satisfies PdfJob, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 3_600, count: 1_000 },
    removeOnFail: false,
    jobId,
  });
};

/**
 * Sending is keyed on the clave de acceso because that is what identifies an
 * InvoicePDF row. The worker is idempotent regardless — it skips a row whose
 * email_estado is already ENVIADO — which matters because the reconciler can
 * legitimately drive the same comprobante through this path more than once.
 */
export const enqueueInvoiceEmail = async (
  claveAcceso: string,
  { force = false }: { force?: boolean } = {},
): Promise<void> => {
  const queue = getQueue(EMAIL_QUEUE);
  const jobId = `email-${claveAcceso}`;

  // Same recovery problem as enqueuePdfGeneration: a job that already reached
  // a terminal state keeps its id, so a plain add is silently ignored. It bit
  // exactly here -- the email job burned all five attempts against a RIDE that
  // did not exist yet, and once the RIDE was finally generated its own failed
  // job id blocked every retry.
  if (force) {
    await queue.remove(jobId).catch(() => undefined);
  }

  await queue.add('send', { claveAcceso } satisfies EmailJob, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 3_600, count: 1_000 },
    removeOnFail: false,
    jobId,
  });
};

/** Closes every queue this process opened. Used by the shutdown path. */
export const closeQueues = async (): Promise<void> => {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
};
