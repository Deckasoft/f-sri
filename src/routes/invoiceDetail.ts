import { Router } from 'express';
import InvoiceDetail from '../models/InvoiceDetail';
import Invoice from '../models/Invoice';
import { getTenantCompanyId } from '../utils/tenant.utils';

const router = Router();

// InvoiceDetail carries no tenant field of its own — it's keyed by
// factura_id (ref Invoice). Every endpoint here scopes access by first
// confirming the referenced Invoice belongs to the authenticated tenant.

router.post('/', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const factura = await Invoice.findOne({ _id: req.body.factura_id, empresa_emisora_id: companyId });
    if (!factura) return res.status(404).json({ message: 'Not found' });

    const doc = new InvoiceDetail(req.body);
    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const facturaIds = await Invoice.find({ empresa_emisora_id: companyId }).distinct('_id');
    const docs = await InvoiceDetail.find({ factura_id: { $in: facturaIds } });
    res.json(docs);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const doc = await InvoiceDetail.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });

    const factura = await Invoice.findOne({ _id: doc.factura_id, empresa_emisora_id: companyId });
    if (!factura) return res.status(404).json({ message: 'Not found' });

    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const existing = await InvoiceDetail.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Not found' });

    const factura = await Invoice.findOne({ _id: existing.factura_id, empresa_emisora_id: companyId });
    if (!factura) return res.status(404).json({ message: 'Not found' });

    const doc = await InvoiceDetail.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const existing = await InvoiceDetail.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Not found' });

    const factura = await Invoice.findOne({ _id: existing.factura_id, empresa_emisora_id: companyId });
    if (!factura) return res.status(404).json({ message: 'Not found' });

    const doc = await InvoiceDetail.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
