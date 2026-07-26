import { Router } from 'express';
import CreditNote from '../models/CreditNote';
import CreditNotePDF from '../models/CreditNotePDF';
import { CreditNoteService } from '../services/credit-note.service';
import { getTenantCompanyId } from '../utils/tenant.utils';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const doc = new CreditNote({ ...req.body, empresa_emisora_id: companyId });
    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/complete', async (req, res) => {
  try {
    if (!req.body.nota_credito) {
      return res.status(400).json({
        success: false,
        message: 'Credit note data is required',
      });
    }

    const companyId = getTenantCompanyId(req);
    const resultado = await CreditNoteService.crearNotaCreditoCompleta(req.body.nota_credito, companyId);

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
      'Datos de nota de crédito inválidos o incompletos',
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
    const docs = await CreditNote.find({ empresa_emisora_id: companyId });
    res.json(docs);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const doc = await CreditNote.findOne({ _id: req.params.id, empresa_emisora_id: companyId });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    // CreditNotePDF has no tenant field of its own; scope it via its parent
    // CreditNote, which does.
    const parent = await CreditNote.findOne({ _id: req.params.id, empresa_emisora_id: companyId });
    if (!parent) return res.status(404).json({ message: 'Not found' });

    const doc = await CreditNotePDF.findOne({ nota_credito_id: req.params.id });
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
    const doc = await CreditNote.findOneAndUpdate({ _id: req.params.id, empresa_emisora_id: companyId }, updateData, {
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
    const doc = await CreditNote.findOneAndDelete({ _id: req.params.id, empresa_emisora_id: companyId });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
