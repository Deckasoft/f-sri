import { Router } from 'express';
import Invoice from '../models/Invoice';
import { InvoiceService } from '../services/invoice.service';
import { getTenantCompanyId } from '../utils/tenant.utils';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const doc = new Invoice({ ...req.body, empresa_emisora_id: companyId });
    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/complete', async (req, res) => {
  try {
    if (!req.body.factura) {
      return res.status(400).json({
        success: false,
        message: 'Invoice data is required',
      });
    }

    const companyId = getTenantCompanyId(req);
    const resultado = await InvoiceService.crearFacturaCompleta(req.body.factura, companyId);

    return res.status(201).json({
      success: true,
      data: resultado,
      xml: resultado.xml,
    });
  } catch (err: any) {
    // Errors that should return 400 (Bad Request)
    const validationErrors = [
      'Product not found',
      'Client not found',
      'Identification type not found',
      'Empresa emisora no encontrada',
      'Invalid date format',
      'Datos de factura inválidos o incompletos',
      // Body RUC doesn't match the authenticated tenant's RUC (Phase 3):
      // emission must be bound to the caller's own company, never to a
      // company selected via the request body.
      'El RUC del comprobante no coincide con la empresa autenticada',
    ];

    const isValidationError = validationErrors.some((error) => err.message.includes(error));

    if (isValidationError) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    // All other errors are server errors (500)
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const docs = await Invoice.find({ empresa_emisora_id: companyId });
    res.json(docs);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const doc = await Invoice.findOne({ _id: req.params.id, empresa_emisora_id: companyId });
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
    const doc = await Invoice.findOneAndUpdate({ _id: req.params.id, empresa_emisora_id: companyId }, updateData, {
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
    const doc = await Invoice.findOneAndDelete({ _id: req.params.id, empresa_emisora_id: companyId });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
