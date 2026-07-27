import { Worker, type Job } from 'bullmq';
import { getRedisConnection } from '../connection';
import { PDF_QUEUE, enqueueInvoiceEmail, type PdfJob } from '../queues';
import { InvoiceService } from '../../services/invoice.service';
import { CreditNoteService } from '../../services/credit-note.service';
import { DebitNoteService } from '../../services/debit-note.service';
import { DeliveryNoteService } from '../../services/delivery-note.service';
import { WithholdingService } from '../../services/withholding.service';
import Invoice from '../../models/Invoice';
import type { DocumentType } from '../../utils/sequence.utils';

const GENERATORS: Record<DocumentType, (documentId: string) => Promise<void>> = {
  '01': (id) => InvoiceService.generarPDFDesdeId(id),
  '04': (id) => CreditNoteService.generarPDFDesdeId(id),
  '05': (id) => DebitNoteService.generarPDFDesdeId(id),
  '06': (id) => DeliveryNoteService.generarPDFDesdeId(id),
  '07': (id) => WithholdingService.generarPDFDesdeId(id),
};

/**
 * Generates the RIDE for an authorized comprobante, then — for facturas —
 * queues the email to the client.
 *
 * Only facturas are emailed: InvoicePDF is the only PDF model carrying the
 * email_* fields, and the RIDE a client expects to receive is the invoice.
 *
 * The generators upsert their PDF row by clave de acceso, so a retry or a
 * regeneration overwrites in place rather than colliding on the unique
 * index. That is what makes this job safe to run more than once, which the
 * reconciler makes routine.
 */
export const processPdfJob = async (job: Job<PdfJob>): Promise<void> => {
  const { documentType, documentId } = job.data;
  const generate = GENERATORS[documentType];
  if (!generate) {
    throw new Error(`Tipo de documento desconocido en la cola de PDF: ${documentType}`);
  }

  await generate(documentId);

  if (documentType === '01') {
    const factura = await Invoice.findById(documentId, { clave_acceso: 1 }).lean();
    if (factura?.clave_acceso) {
      await enqueueInvoiceEmail(factura.clave_acceso);
    }
  }
};

export const createPdfWorker = (): Worker<PdfJob> =>
  new Worker<PdfJob>(PDF_QUEUE, processPdfJob, {
    connection: getRedisConnection(),
    // Each job launches a headless Chromium (see src/utils/pdf.utils.ts),
    // which is memory-hungry; the worker container is capped at 512m.
    concurrency: 2,
  });
