import { Router } from 'express';
import { z } from 'zod';
import Product from '../models/Product';
import { getTenantCompanyId } from '../utils/tenant.utils';
import { isDuplicateKeyError } from '../utils/mongo.utils';

const router = Router();

// Mirrors src/models/Product.ts. Validating here rather than relying on
// Mongoose's own required-field errors is what lets a missing field come
// back as a 400 naming it, instead of the blanket 500 the catch block would
// otherwise produce. tiene_iva in particular is load-bearing downstream —
// src/utils/xml.utils.ts drives the IVA computation off it — so a product
// saved without it would silently mis-total every invoice that used it.
const productSchema = z.object({
  codigo: z.string().min(1),
  descripcion: z.string().min(1),
  precio_unitario: z.number().nonnegative(),
  tiene_iva: z.boolean(),
  descripcion_adicional: z.string().optional(),
});

const updateProductSchema = productSchema.partial();

router.post('/', async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos de producto inválidos', errors: parsed.error.issues });
  }

  try {
    const companyId = getTenantCompanyId(req);
    const doc = new Product({ ...parsed.data, empresa_emisora_id: companyId });
    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({ message: 'Ya existe un producto con ese código' });
    }
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
  // The schema has no empresa_emisora_id, so parsing already strips any
  // attempt to reassign a product to another tenant — the explicit discard
  // this replaced is no longer needed.
  const parsed = updateProductSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos de producto inválidos', errors: parsed.error.issues });
  }

  try {
    const companyId = getTenantCompanyId(req);
    const doc = await Product.findOneAndUpdate({ _id: req.params.id, empresa_emisora_id: companyId }, parsed.data, {
      new: true,
    });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({ message: 'Ya existe un producto con ese código' });
    }
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
