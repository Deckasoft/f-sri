import { Router } from 'express';
import InvoicePDF from '../models/InvoicePDF';
import Invoice from '../models/Invoice';
import Client from '../models/Client';
import IssuingCompany from '../models/IssuingCompany';
import { getTenantCompanyId } from '../utils/tenant.utils';
import { sendInvoiceEmail } from '../utils/email.utils';
import { PDFStorageFactory } from '../services/storage';

const router = Router();

// InvoicePDF carries no tenant field of its own — it's keyed by factura_id
// (ref Invoice) or, on some endpoints, only by claveAcceso. Every endpoint
// here scopes access by confirming the referenced Invoice belongs to the
// authenticated tenant before returning or mutating anything.

// Get all invoice PDFs (scoped to the tenant's own invoices)
router.get('/', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const facturaIds = await Invoice.find({ empresa_emisora_id: companyId }).distinct('_id');
    const docs = await InvoicePDF.find({ factura_id: { $in: facturaIds.map((id) => String(id)) } }).populate(
      'factura_id',
    );
    res.json(docs);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get PDF by invoice ID
router.get('/invoice/:facturaId', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const factura = await Invoice.findOne({ _id: req.params.facturaId, empresa_emisora_id: companyId });
    if (!factura) return res.status(404).json({ message: 'PDF not found' });

    const doc = await InvoicePDF.findOne({ factura_id: req.params.facturaId });
    if (!doc) return res.status(404).json({ message: 'PDF not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get PDF by access key — no factura_id in the URL, so the PDF is looked up
// first and its owning invoice is verified before returning anything.
router.get('/access-key/:claveAcceso', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const doc = await InvoicePDF.findOne({ claveAcceso: req.params.claveAcceso });
    if (!doc) return res.status(404).json({ message: 'PDF not found' });

    const factura = await Invoice.findOne({ _id: doc.factura_id, empresa_emisora_id: companyId });
    if (!factura) return res.status(404).json({ message: 'PDF not found' });

    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Download PDF file
// Redirige a una URL de descarga fresca resuelta desde el almacenamiento
// configurado. Con S3 (bucket privado) doc.pdf_url/pdf_public_id es una
// clave de objeto, no una URL pública, así que aquí se genera una URL
// presignada de corta duración en el momento — nunca se persiste.
router.get('/download/:claveAcceso', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const doc = await InvoicePDF.findOne({ claveAcceso: req.params.claveAcceso });
    if (!doc) return res.status(404).json({ message: 'PDF not found' });

    const factura = await Invoice.findOne({ _id: doc.factura_id, empresa_emisora_id: companyId });
    if (!factura) return res.status(404).json({ message: 'PDF not found' });

    if (!doc.pdf_url || !doc.pdf_public_id) {
      return res.status(404).json({ message: 'PDF URL not available' });
    }

    const storage = PDFStorageFactory.create();
    const downloadUrl = await storage.getDownloadUrl(doc.pdf_public_id);
    res.redirect(downloadUrl);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Regenerate PDF for a specific invoice
router.post('/regenerate/:facturaId', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const factura = await Invoice.findOne({ _id: req.params.facturaId, empresa_emisora_id: companyId });
    if (!factura) return res.status(404).json({ message: 'Invoice not found' });

    // This would trigger PDF regeneration
    // For now, just return a message
    res.json({ message: 'PDF regeneration requested', facturaId: req.params.facturaId });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Resolves the client/company names used in the email template/body for a
// given invoice. Best-effort: a missing related record falls back to a
// generic label rather than failing the whole send.
const resolveEmailNames = async (factura: {
  cliente_id: unknown;
  empresa_emisora_id: unknown;
}): Promise<{ clientName: string; companyName: string }> => {
  const [cliente, empresa] = await Promise.all([
    Client.findById(factura.cliente_id),
    IssuingCompany.findById(factura.empresa_emisora_id),
  ]);

  return {
    clientName: cliente?.razon_social ?? 'Cliente',
    companyName: empresa?.razon_social ?? 'Empresa',
  };
};

// Send PDF via email
router.post('/send-email/:claveAcceso', async (req, res) => {
  try {
    const { email_destinatario } = req.body;

    if (!email_destinatario) {
      return res.status(400).json({ message: 'Email destinatario is required' });
    }

    const companyId = getTenantCompanyId(req);
    const doc = await InvoicePDF.findOne({ claveAcceso: req.params.claveAcceso });
    if (!doc) return res.status(404).json({ message: 'PDF not found' });

    const factura = await Invoice.findOne({ _id: doc.factura_id, empresa_emisora_id: companyId });
    if (!factura) return res.status(404).json({ message: 'PDF not found' });

    doc.email_destinatario = email_destinatario;

    const { clientName, companyName } = await resolveEmailNames(factura);
    const result = await sendInvoiceEmail(doc, email_destinatario, clientName, companyName);

    doc.email_intentos = (doc.email_intentos ?? 0) + 1;
    if (result.success) {
      doc.email_estado = 'ENVIADO';
      doc.email_fecha_envio = new Date();
      doc.email_ultimo_error = undefined;
    } else {
      doc.email_estado = 'ERROR';
      doc.email_ultimo_error = result.error;
    }

    await doc.save();

    res.json({
      message: result.success ? 'Email sent successfully' : 'Email sending failed',
      claveAcceso: req.params.claveAcceso,
      destinatario: email_destinatario,
      estado: doc.email_estado,
      ...(result.success ? {} : { error: result.error }),
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get email status for a PDF
router.get('/email-status/:claveAcceso', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const doc = await InvoicePDF.findOne({ claveAcceso: req.params.claveAcceso });
    if (!doc) return res.status(404).json({ message: 'PDF not found' });

    const factura = await Invoice.findOne({ _id: doc.factura_id, empresa_emisora_id: companyId });
    if (!factura) return res.status(404).json({ message: 'PDF not found' });

    res.json({
      claveAcceso: req.params.claveAcceso,
      email_estado: doc.email_estado,
      email_destinatario: doc.email_destinatario,
      email_fecha_envio: doc.email_fecha_envio,
      email_intentos: doc.email_intentos,
      email_ultimo_error: doc.email_ultimo_error,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Retry email sending
router.post('/retry-email/:claveAcceso', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const doc = await InvoicePDF.findOne({ claveAcceso: req.params.claveAcceso });
    if (!doc) return res.status(404).json({ message: 'PDF not found' });

    const factura = await Invoice.findOne({ _id: doc.factura_id, empresa_emisora_id: companyId });
    if (!factura) return res.status(404).json({ message: 'PDF not found' });

    if (doc.email_estado === 'ENVIADO') {
      return res.status(400).json({ message: 'Email already sent successfully' });
    }

    if (!doc.email_destinatario) {
      return res.status(400).json({ message: 'No recipient email on file for this document' });
    }

    const { clientName, companyName } = await resolveEmailNames(factura);
    const result = await sendInvoiceEmail(doc, doc.email_destinatario, clientName, companyName);

    doc.email_intentos = (doc.email_intentos ?? 0) + 1;
    if (result.success) {
      doc.email_estado = 'ENVIADO';
      doc.email_fecha_envio = new Date();
      doc.email_ultimo_error = undefined;
    } else {
      doc.email_estado = 'ERROR';
      doc.email_ultimo_error = result.error;
    }

    await doc.save();

    res.json({
      message: result.success ? 'Email sent successfully' : 'Email sending failed',
      claveAcceso: req.params.claveAcceso,
      estado: doc.email_estado,
      ...(result.success ? {} : { error: result.error }),
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
