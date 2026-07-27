import { Queue, type JobsOptions } from 'bullmq';
import { getRedisConnection } from './connection';
import type { DocumentType } from '../utils/sequence.utils';

export const AUTHORIZATION_QUEUE = 'sri-authorization';

/** Payload of every authorization-check job. */
export type AuthorizationJob = {
  documentType: DocumentType;
  documentId: string;
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

/** Closes every queue this process opened. Used by the shutdown path. */
export const closeQueues = async (): Promise<void> => {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
};
