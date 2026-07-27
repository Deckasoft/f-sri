import { Worker, type Job } from 'bullmq';
import { getRedisConnection } from '../connection';
import { PDF_QUEUE, enqueueInvoiceEmail, type PdfJob } from '../queues';
import { InvoiceService } from '../../services/invoice.service';
import { CreditNoteService } from '../../services/credit-note.service';
import { DebitNoteService } from '../../services/debit-note.service';
import { DeliveryNoteService } from '../../services/delivery-note.service';
import { WithholdingService } from '../../services/withholding.service';
import Invoice from '../../models/Invoice';
import CreditNote from '../../models/CreditNote';
import DebitNote from '../../models/DebitNote';
import DeliveryNote from '../../models/DeliveryNote';
import Withholding from '../../models/Withholding';
import InvoicePDF from '../../models/InvoicePDF';
import CreditNotePDF from '../../models/CreditNotePDF';
import DebitNotePDF from '../../models/DebitNotePDF';
import DeliveryNotePDF from '../../models/DeliveryNotePDF';
import WithholdingPDF from '../../models/WithholdingPDF';
import type { DocumentType } from '../../utils/sequence.utils';

const GENERATORS: Record<
  DocumentType,
  { generate: (documentId: string) => Promise<void>; model: any; pdfModel: any }
> = {
  '01': { generate: (id) => InvoiceService.generarPDFDesdeId(id), model: Invoice, pdfModel: InvoicePDF },
  '04': { generate: (id) => CreditNoteService.generarPDFDesdeId(id), model: CreditNote, pdfModel: CreditNotePDF },
  '05': { generate: (id) => DebitNoteService.generarPDFDesdeId(id), model: DebitNote, pdfModel: DebitNotePDF },
  '06': { generate: (id) => DeliveryNoteService.generarPDFDesdeId(id), model: DeliveryNote, pdfModel: DeliveryNotePDF },
  '07': { generate: (id) => WithholdingService.generarPDFDesdeId(id), model: Withholding, pdfModel: WithholdingPDF },
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
  const entry = GENERATORS[documentType];
  if (!entry) {
    throw new Error(`Tipo de documento desconocido en la cola de PDF: ${documentType}`);
  }

  await entry.generate(documentId);

  // Verify the RIDE actually exists, rather than trusting that nothing threw.
  //
  // The generators swallow their own failures: they catch, log, and write an
  // 'ERROR' row instead of rethrowing. So a job whose Chromium never launched
  // still returned normally, BullMQ marked it COMPLETED, and the attempts/
  // backoff configured on this queue never applied -- it was dead
  // configuration. Worse, the completed job id then blocked any re-enqueue,
  // because job ids are deduplicated.
  //
  // Checking the outcome instead of the absence of an exception is what makes
  // the retry budget real.
  const documento: any = await entry.model.findById(documentId, { clave_acceso: 1 }).lean();
  if (!documento?.clave_acceso) {
    throw new Error(`Comprobante ${documentType}:${documentId} no encontrado tras generar el RIDE`);
  }

  const pdf: any = await entry.pdfModel.findOne({ claveAcceso: documento.clave_acceso }, { estado: 1 }).lean();
  if (pdf?.estado !== 'GENERADO') {
    throw new Error(
      `El RIDE de ${documentType}:${documentId} no se generó (estado: ${pdf?.estado ?? 'sin registro'})`,
    );
  }

  if (documentType === '01') {
    await enqueueInvoiceEmail(documento.clave_acceso);
  }
};

export const createPdfWorker = (): Worker<PdfJob> =>
  new Worker<PdfJob>(PDF_QUEUE, processPdfJob, {
    connection: getRedisConnection(),
    // One at a time. Each job launches a headless Chromium (see
    // src/utils/pdf.utils.ts); two concurrent instances in a memory-capped
    // container is what made Chromium fail to launch at all. Throughput here
    // is not the constraint -- correctness is.
    concurrency: 1,
  });
