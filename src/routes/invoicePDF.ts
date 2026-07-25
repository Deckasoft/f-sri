import { Router } from 'express';
import InvoicePDF from '../models/InvoicePDF';
import Invoice from '../models/Invoice';
import { getTenantCompanyId } from '../utils/tenant.utils';

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
// Redirige a la URL pública del PDF (Cloudinary, local storage, etc.)
router.get('/download/:claveAcceso', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const doc = await InvoicePDF.findOne({ claveAcceso: req.params.claveAcceso });
    if (!doc) return res.status(404).json({ message: 'PDF not found' });

    const factura = await Invoice.findOne({ _id: doc.factura_id, empresa_emisora_id: companyId });
    if (!factura) return res.status(404).json({ message: 'PDF not found' });

    if (doc.pdf_url) {
      // Redirigir a la URL pública del PDF
      res.redirect(doc.pdf_url);
    } else {
      res.status(404).json({ message: 'PDF URL not available' });
    }
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

    // Update email fields for future implementation
    doc.email_estado = 'PENDIENTE';
    doc.email_destinatario = email_destinatario;
    doc.email_intentos = 0;
    doc.email_ultimo_error = undefined;
    // doc.email_enviado_por = req.user?.id; // When auth is implemented

    await doc.save();

    // TODO: Implement actual email sending logic here
    res.json({
      message: 'Email sending request queued',
      claveAcceso: req.params.claveAcceso,
      destinatario: email_destinatario,
      estado: 'PENDIENTE',
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

    // Reset for retry
    doc.email_estado = 'PENDIENTE';
    doc.email_ultimo_error = undefined;

    await doc.save();

    // TODO: Implement actual email retry logic here
    res.json({
      message: 'Email retry requested',
      claveAcceso: req.params.claveAcceso,
      estado: 'PENDIENTE',
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
