import { Router } from 'express';
import { z } from 'zod';
import IssuingCompany from '../../models/IssuingCompany';
import { isValidRUC } from '../../utils/validation.utils';
import { getAdminUserId } from '../../utils/admin.utils';
import { isDuplicateKeyError } from '../../utils/mongo.utils';

// Admin-only tenant provisioning and management. Mounted at /admin/api/tenants,
// behind adminAuth (see src/routes/admin/index.ts). Unlike
// src/routes/issuingCompany.ts (tenant self-service, scoped to req.auth.companyId),
// these routes operate on any tenant by :id, because only an admin caller can
// reach them at all.
const router = Router();

// Fields an admin may set about a tenant's business profile. Deliberately
// excludes certificate/certificate_password (only ever arrive via the
// client's own onboarding flow or its self-service PUT /certificate), active
// (flipped only via the dedicated PUT /:id/active), and onboarded_at (set
// exclusively by the onboarding completion flow). Using a zod object (rather
// than a UPDATABLE_FIELDS name whitelist) means values are validated too, not
// just field names present — e.g. tipo_ambiente can only ever be 1 or 2.
const tenantProfileSchema = z.object({
  razon_social: z.string().min(1),
  nombre_comercial: z.string().min(1),
  direccion: z.string().optional(),
  direccion_matriz: z.string().optional(),
  direccion_establecimiento: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().email().optional(),
  // Exactly three digits, per the SRI: they concatenate into the 6-character
  // serie of every clave de acceso this tenant emits. A bare z.string() let a
  // customer's "punto de emisión 1" through as "1", producing a 4-character
  // serie in a 49-digit key -- malformed, rejected by the SRI, and not
  // obviously traceable back to this form field.
  codigo_establecimiento: z
    .string()
    .regex(/^\d{3}$/, 'Debe ser exactamente 3 dígitos (p. ej. 001)')
    .optional(),
  punto_emision: z
    .string()
    .regex(/^\d{3}$/, 'Debe ser exactamente 3 dígitos (p. ej. 001)')
    .optional(),
  tipo_ambiente: z.union([z.literal(1), z.literal(2)]).optional(),
  tipo_emision: z.literal(1).optional(),
  obligado_contabilidad: z.boolean().optional(),
  contribuyente_especial: z.string().optional(),
  email_notificacion: z.string().email().optional(),
});

const createTenantSchema = tenantProfileSchema.extend({
  ruc: z.string().refine(isValidRUC, { message: 'RUC inválido: debe tener 13 dígitos y terminar en 001' }),
});

const updateTenantSchema = tenantProfileSchema.partial();

const setActiveSchema = z.object({ active: z.boolean() });

router.get('/', async (_req, res) => {
  try {
    const docs = await IssuingCompany.find({}).sort({ createdAt: -1 });
    res.json(docs);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', async (req, res) => {
  const parsed = createTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid tenant data', errors: parsed.error.issues });
  }

  try {
    const doc = new IssuingCompany({
      ...parsed.data,
      created_by: getAdminUserId(req),
    });
    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({ message: 'Ya existe una empresa con ese RUC' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await IssuingCompany.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', async (req, res) => {
  const parsed = updateTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid tenant data', errors: parsed.error.issues });
  }

  try {
    const doc = await IssuingCompany.findByIdAndUpdate(req.params.id, parsed.data, { new: true });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id/active', async (req, res) => {
  const parsed = setActiveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid body: { active: boolean } required' });
  }

  try {
    const doc = await IssuingCompany.findByIdAndUpdate(req.params.id, { active: parsed.data.active }, { new: true });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
