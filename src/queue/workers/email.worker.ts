import { Worker, type Job } from 'bullmq';
import { getRedisConnection } from '../connection';
import { EMAIL_QUEUE, type EmailJob } from '../queues';
import { sendInvoiceEmail } from '../../utils/email.utils';
import InvoicePDF from '../../models/InvoicePDF';
import Invoice from '../../models/Invoice';
import Client from '../../models/Client';
import IssuingCompany from '../../models/IssuingCompany';

/**
 * Emails an authorized factura's RIDE to the client.
 *
 * This closes a gap rather than adding a feature: sendInvoiceEmail was
 * complete and correct, but nothing outside two manual HTTP endpoints ever
 * called it, while the README advertised automatic sending. Invoices were
 * authorized and simply never delivered.
 *
 * Idempotent by design. The reconciler can legitimately drive an already
 * authorized comprobante back through the PDF job, which re-enqueues this
 * one; a row already marked ENVIADO is skipped so the client is not mailed
 * the same factura twice.
 */
export const processEmailJob = async (job: Job<EmailJob>): Promise<void> => {
  const { claveAcceso } = job.data;

  const invoicePDF = await InvoicePDF.findOne({ claveAcceso });
  if (!invoicePDF) {
    throw new Error(`No hay RIDE para la clave de acceso ${claveAcceso}`);
  }
  if (invoicePDF.email_estado === 'ENVIADO') {
    return;
  }

  const factura = await Invoice.findById(invoicePDF.factura_id);
  if (!factura) {
    throw new Error(`La factura del RIDE ${claveAcceso} ya no existe`);
  }

  const [cliente, empresa] = await Promise.all([
    Client.findById(factura.cliente_id),
    IssuingCompany.findById(factura.empresa_emisora_id),
  ]);

  // The client's own address is the intended recipient. The emisor's
  // notification address is a fallback so an authorized factura is not left
  // undeliverable just because the client record has no email — but that
  // fallback means the RIDE does NOT reach the customer, so it is recorded
  // rather than performed quietly. Without both the warning and the flag,
  // email_estado reads ENVIADO and everyone assumes the client got it.
  const sentToEmisorInstead = !cliente?.email && Boolean(empresa?.email_notificacion);
  const recipient = cliente?.email || empresa?.email_notificacion;

  if (sentToEmisorInstead) {
    console.warn(
      `⚠️  El cliente "${cliente?.razon_social ?? 'desconocido'}" (${cliente?.identificacion ?? 's/ID'}) no tiene ` +
        `email: el RIDE ${claveAcceso} se enviará a ${empresa?.email_notificacion} (emisor), NO al cliente. ` +
        'Añade el email del cliente para que lo reciba.',
    );
  }

  if (!recipient) {
    // ERROR, not NO_ENVIADO. NO_ENVIADO is the model's default and therefore
    // means "not attempted yet" -- which is exactly what the reconciler
    // sweeps for. Reusing it here would make an undeliverable RIDE
    // indistinguishable from one whose job was lost, and the reconciler
    // would re-enqueue it forever.
    invoicePDF.email_estado = 'ERROR';
    invoicePDF.email_intentos = (invoicePDF.email_intentos ?? 0) + 1;
    invoicePDF.email_ultimo_error = 'El cliente no tiene email y la empresa no tiene email_notificacion';
    await invoicePDF.save();
    // Not thrown: retrying cannot conjure an address. It is recorded on the
    // row so the gap is visible instead of silent.
    return;
  }

  const result = await sendInvoiceEmail(
    invoicePDF,
    recipient,
    cliente?.razon_social ?? 'Cliente',
    empresa?.razon_social ?? 'Empresa',
  );

  invoicePDF.email_destinatario = recipient;
  invoicePDF.email_enviado_al_emisor = sentToEmisorInstead;
  invoicePDF.email_intentos = (invoicePDF.email_intentos ?? 0) + 1;

  if (result.success) {
    invoicePDF.email_estado = 'ENVIADO';
    invoicePDF.email_fecha_envio = new Date();
    invoicePDF.email_ultimo_error = undefined;
    await invoicePDF.save();
    return;
  }

  invoicePDF.email_estado = 'ERROR';
  invoicePDF.email_ultimo_error = result.error;
  await invoicePDF.save();

  // Throwing hands the retry to BullMQ's backoff. Resend being briefly
  // unavailable should not cost the client their factura.
  throw new Error(`No se pudo enviar el email de ${claveAcceso}: ${result.error}`);
};

export const createEmailWorker = (): Worker<EmailJob> =>
  new Worker<EmailJob>(EMAIL_QUEUE, processEmailJob, {
    connection: getRedisConnection(),
    concurrency: 5,
  });
