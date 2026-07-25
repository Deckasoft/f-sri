import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Router } from 'express';
import IssuingCompany from '../models/IssuingCompany';
import { encrypt } from '../utils/encryption.utils';
import { verifyP12Password } from '../utils/certificate.utils';
import { getTenantCompanyId } from '../utils/tenant.utils';

// Tenant self-service: a company can only ever see or edit *itself*,
// identified by the authenticated req.auth.companyId — never by a URL
// param, and never a listing of other tenants. This replaces the old
// find()-all / :id-scoped CRUD, which let any authenticated caller read,
// edit or delete every other tenant's IssuingCompany record.
const router = Router();

// Fields a tenant may update about its own company profile. Deliberately
// excludes ruc (immutable tenant identity), active (tenant self-service must
// not be able to reactivate/deactivate itself), certificate/certificate_password
// (handled exclusively by PUT /certificate, which verifies the P12 opens
// before storing it), and _id.
const UPDATABLE_FIELDS = [
  'razon_social',
  'nombre_comercial',
  'direccion',
  'direccion_matriz',
  'direccion_establecimiento',
  'telefono',
  'email',
  'email_notificacion',
  'codigo_establecimiento',
  'punto_emision',
  'tipo_ambiente',
  'tipo_emision',
  'obligado_contabilidad',
  'contribuyente_especial',
] as const;

type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

const pickUpdatableFields = (body: Record<string, unknown>): Partial<Record<UpdatableField, unknown>> => {
  const entries = UPDATABLE_FIELDS.filter((field) => field in body).map((field) => [field, body[field]] as const);
  return Object.fromEntries(entries);
};

/**
 * Verifies a P12 certificate (received as base64 in the request body, not
 * yet encrypted) actually opens with the given password, by materializing
 * it to a short-lived temp file — mirroring the lifecycle guarantees of
 * src/utils/certificate.utils.ts#withCompanyP12, but for a certificate that
 * hasn't been stored (and encrypted) yet.
 */
const verifyIncomingP12 = async (
  certificateBase64: string,
  password: string,
): Promise<{ valid: boolean; error?: string }> => {
  const p12Buffer = Buffer.from(certificateBase64, 'base64');
  if (p12Buffer.length === 0) {
    return { valid: false, error: 'El certificado está vacío' };
  }

  const p12Path = path.join(os.tmpdir(), `${crypto.randomUUID()}.p12`);
  fs.writeFileSync(p12Path, p12Buffer, { mode: 0o600 });

  try {
    return await verifyP12Password(p12Path, password);
  } finally {
    await fs.promises.unlink(p12Path).catch(() => undefined);
  }
};

router.get('/', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    // certificate/certificate_password are select: false by default — never
    // .select('+certificate ...') here, this endpoint must never expose them.
    const doc = await IssuingCompany.findById(companyId);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const updateData = pickUpdatableFields(req.body);

    const doc = await IssuingCompany.findByIdAndUpdate(companyId, updateData, { new: true });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/certificate', async (req, res) => {
  try {
    const companyId = getTenantCompanyId(req);
    const { certificate, certificate_password: certificatePassword } = req.body;

    if (!certificate || !certificatePassword) {
      return res.status(400).json({ message: 'certificate and certificate_password are required' });
    }

    const verification = await verifyIncomingP12(certificate, certificatePassword);
    if (!verification.valid) {
      return res.status(400).json({ message: `Invalid P12 certificate: ${verification.error}` });
    }

    const doc = await IssuingCompany.findByIdAndUpdate(
      companyId,
      { certificate: encrypt(certificate), certificate_password: encrypt(certificatePassword) },
      { new: true },
    );
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Certificate updated' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
