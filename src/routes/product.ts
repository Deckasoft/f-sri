import { Router } from 'express';
import Product from '../models/Product';
import { getTenantCompanyId } from '../utils/tenant.utils';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const doc = new Product({ ...req.body, empresa_emisora_id: companyId });
    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const docs = await Product.find({ empresa_emisora_id: companyId });
    res.json(docs);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const doc = await Product.findOne({ _id: req.params.id, empresa_emisora_id: companyId });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const { empresa_emisora_id: _ignoredCompanyId, ...updateData } = req.body;
    const doc = await Product.findOneAndUpdate({ _id: req.params.id, empresa_emisora_id: companyId }, updateData, {
      new: true,
    });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const doc = await Product.findOneAndDelete({ _id: req.params.id, empresa_emisora_id: companyId });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
