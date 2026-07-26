import { Resend } from 'resend';
import Invoice from '../models/Invoice';
import { IInvoicePDF } from '../models/InvoicePDF';
import { PDFStorageFactory } from '../services/storage';

interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

interface EmailConfig {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

/**
 * Generates email template for invoice PDF
 *
 * El PDF ya no se referencia mediante un enlace de descarga: se adjunta al
 * email como archivo real (ver sendInvoiceEmail), porque el enlace basado en
 * pdf_url dejó de ser un valor confiable para mostrar al destinatario — con
 * el proveedor S3, pdf_url almacena la clave privada del objeto, no una URL
 * pública, y una URL presignada expiraría de todos modos.
 */
export function generateInvoiceEmailTemplate(
  invoicePDF: IInvoicePDF,
  clientName: string,
  companyName: string,
): EmailTemplate {
  // Validar que el PDF exista en el almacenamiento antes de generar el email
  if (!invoicePDF.pdf_public_id) {
    throw new Error('PDF no disponible. El PDF debe estar almacenado antes de enviar el email.');
  }

  const subject = `Factura Electrónica - ${invoicePDF.claveAcceso}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Factura Electrónica</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .content { margin-bottom: 20px; }
        .footer { font-size: 12px; color: #666; border-top: 1px solid #ddd; padding-top: 10px; }
        .invoice-details { background-color: #e9ecef; padding: 15px; border-radius: 5px; margin: 15px 0; }
        .attachment-note {
          background-color: #d4edda;
          color: #155724;
          padding: 12px 16px;
          border-radius: 5px;
          margin: 15px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Factura Electrónica</h2>
          <p>Estimado/a ${clientName},</p>
        </div>

        <div class="content">
          <p>Su factura electrónica ha sido emitida por <strong>${companyName}</strong>.</p>

          <div class="invoice-details">
            <strong>Detalles de la Factura:</strong><br>
            <strong>Clave de Acceso:</strong> ${invoicePDF.claveAcceso}<br>
            <strong>Número de Autorización:</strong> ${invoicePDF.numero_autorizacion}<br>
            <strong>Fecha de Autorización:</strong> ${invoicePDF.fecha_autorizacion.toLocaleDateString('es-EC')}<br>
            <strong>Fecha de Generación PDF:</strong> ${invoicePDF.fecha_generacion.toLocaleDateString('es-EC')}
          </div>

          <p class="attachment-note">
            📎 Encontrará la factura en formato PDF adjunta a este correo.
          </p>

          <p>Por favor, conserve este documento para sus registros contables.</p>

          <p>Si tiene alguna consulta sobre esta factura, no dude en contactarnos.</p>
        </div>

        <div class="footer">
          <p>Este es un mensaje automático. Por favor, no responda a este correo.</p>
          <p>Factura generada por Veronica-EC - Sistema de Facturación Electrónica Libre</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
    Factura Electrónica

    Estimado/a ${clientName},

    Su factura electrónica ha sido emitida por ${companyName}.

    Detalles de la Factura:
    Clave de Acceso: ${invoicePDF.claveAcceso}
    Número de Autorización: ${invoicePDF.numero_autorizacion}
    Fecha de Autorización: ${invoicePDF.fecha_autorizacion.toLocaleDateString('es-EC')}
    Fecha de Generación PDF: ${invoicePDF.fecha_generacion.toLocaleDateString('es-EC')}

    Encontrará la factura en formato PDF adjunta a este correo.

    Por favor, conserve este documento para sus registros contables.

    Si tiene alguna consulta sobre esta factura, no dude en contactarnos.

    Este es un mensaje automático. Por favor, no responda a este correo.
    Factura generada por Veronica-EC - Sistema de Facturación Electrónica Libre
  `;

  return { subject, html, text };
}

/**
 * Prepares email configuration for sending
 *
 * El PDF (y, cuando exista, el XML autorizado) se adjuntan como archivos
 * reales — nunca como un enlace, que podría expirar (S3) o simplemente
 * dejar de reflejar el documento correcto.
 */
export function prepareEmailConfig(
  invoicePDF: IInvoicePDF,
  emailTemplate: EmailTemplate,
  recipientEmail: string,
  attachments: EmailAttachment[] = [],
): EmailConfig {
  const config: EmailConfig = {
    to: recipientEmail,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
    text: emailTemplate.text,
  };

  return attachments.length > 0 ? { ...config, attachments } : config;
}

/**
 * Validates email address format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Best-effort fetch of the signed XML for the invoice backing this PDF, to
 * attach alongside it (SRI custom is PDF + XML). Returns undefined instead
 * of throwing so a missing/unavailable XML never blocks sending the PDF,
 * which is the actual deliverable.
 */
const buildXmlAttachment = async (invoicePDF: IInvoicePDF): Promise<EmailAttachment | undefined> => {
  try {
    const factura = await Invoice.findById(invoicePDF.factura_id);
    if (!factura?.xml_firmado) {
      return undefined;
    }
    return {
      filename: `${invoicePDF.claveAcceso}.xml`,
      content: Buffer.from(factura.xml_firmado, 'utf-8'),
      contentType: 'application/xml',
    };
  } catch (error) {
    console.warn('⚠️  No se pudo adjuntar el XML autorizado (se enviará solo el PDF):', error);
    return undefined;
  }
};

/**
 * Sends invoice email using Resend, with the RIDE PDF always attached as a
 * real file (fetched from the configured storage provider — S3 in
 * production) and the authorized XML attached best-effort when available.
 */
export async function sendInvoiceEmail(
  invoicePDF: IInvoicePDF,
  recipientEmail: string,
  clientName: string,
  companyName: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    // Validate email
    if (!isValidEmail(recipientEmail)) {
      throw new Error('Formato de email inválido');
    }

    // Check if email is configured
    const apiKey = process.env.RESEND_API_KEY;
    const emailFrom = process.env.EMAIL_FROM;
    if (!apiKey || !emailFrom) {
      console.warn('Email service not configured. Email sending is disabled.');
      return {
        success: false,
        error: 'Servicio de email no configurado. Configure RESEND_API_KEY y EMAIL_FROM.',
      };
    }

    // Generate email template
    const template = generateInvoiceEmailTemplate(invoicePDF, clientName, companyName);

    // Fetch the RIDE PDF bytes from the configured storage provider (S3 in
    // production via GetObject) — the attachment is the deliverable, never
    // a link.
    const storage = PDFStorageFactory.create();
    const pdfBuffer = await storage.getFileBuffer(invoicePDF.pdf_public_id);

    const attachments: EmailAttachment[] = [
      { filename: `${invoicePDF.claveAcceso}.pdf`, content: pdfBuffer, contentType: 'application/pdf' },
    ];

    const xmlAttachment = await buildXmlAttachment(invoicePDF);
    if (xmlAttachment) {
      attachments.push(xmlAttachment);
    }

    // Prepare email config
    const emailConfig = prepareEmailConfig(invoicePDF, template, recipientEmail, attachments);

    // Send via Resend
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: emailFrom,
      to: emailConfig.to,
      subject: emailConfig.subject,
      html: emailConfig.html,
      text: emailConfig.text,
      attachments: emailConfig.attachments,
    });

    if (error) {
      throw new Error(error.message);
    }

    console.log('✅ Email sent successfully:', {
      to: emailConfig.to,
      subject: emailConfig.subject,
      messageId: data?.id,
    });

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error) {
    console.error('❌ Error sending email:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}
