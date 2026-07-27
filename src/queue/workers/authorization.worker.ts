import { Worker, type Job } from 'bullmq';
import { getRedisConnection } from '../connection';
import { AUTHORIZATION_QUEUE, type AuthorizationJob } from '../queues';
import { InvoiceService } from '../../services/invoice.service';
import { CreditNoteService } from '../../services/credit-note.service';
import { DebitNoteService } from '../../services/debit-note.service';
import { DeliveryNoteService } from '../../services/delivery-note.service';
import { WithholdingService } from '../../services/withholding.service';
import type { DocumentType } from '../../utils/sequence.utils';

/**
 * Terminal SRI states. Anything else means the comprobante is still being
 * processed and the job has to be retried.
 */
const TERMINAL_STATES = ['AUTORIZADO', 'NO AUTORIZADO'];

type AuthorizationChecker = (documentId: string) => Promise<{ estado?: string } | null>;

const CHECKERS: Record<DocumentType, AuthorizationChecker> = {
  '01': (id) => InvoiceService.consultarAutorizacionSRI(id),
  '04': (id) => CreditNoteService.consultarAutorizacionSRI(id),
  '05': (id) => DebitNoteService.consultarAutorizacionSRI(id),
  '06': (id) => DeliveryNoteService.consultarAutorizacionSRI(id),
  '07': (id) => WithholdingService.consultarAutorizacionSRI(id),
};

/**
 * Polls the SRI for one comprobante's authorization.
 *
 * Throwing is how a still-pending document gets retried: BullMQ reschedules
 * the job with exponential backoff, which replaces the old fixed budget of
 * three attempts five seconds apart in an in-memory timer. That budget meant
 * a comprobante the SRI took longer than ~15s to authorize was abandoned in
 * PENDIENTE with nothing to pick it up again, and a deploy dropped every
 * pending check outright.
 */
export const processAuthorizationJob = async (job: Job<AuthorizationJob>): Promise<void> => {
  const { documentType, documentId } = job.data;
  const check = CHECKERS[documentType];
  if (!check) {
    // Not retryable — a bad document type will never become valid.
    throw new Error(`Tipo de documento desconocido en la cola: ${documentType}`);
  }

  const resultado = await check(documentId);
  const estado = resultado?.estado;

  if (!estado || !TERMINAL_STATES.includes(estado)) {
    throw new Error(
      `Comprobante ${documentType}:${documentId} aún sin autorizar (estado: ${estado ?? 'sin respuesta'})`,
    );
  }
};

export const createAuthorizationWorker = (): Worker<AuthorizationJob> =>
  new Worker<AuthorizationJob>(AUTHORIZATION_QUEUE, processAuthorizationJob, {
    connection: getRedisConnection(),
    // The SRI is the bottleneck and rate-limits aggressive callers, so this
    // stays modest rather than tracking CPU count.
    concurrency: 5,
  });
