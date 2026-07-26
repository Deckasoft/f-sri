import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Router } from 'express';
import { z } from 'zod';
import Invite from '../models/Invite';
import IssuingCompany from '../models/IssuingCompany';
import ApiKey from '../models/ApiKey';
import { encrypt } from '../utils/encryption.utils';
import { verifyP12Password } from '../utils/certificate.utils';
import { generateApiKey } from '../utils/apiKey.utils';
import { hashInviteToken } from '../utils/invite.utils';
import { onboardingLimiter } from '../config/rateLimit.config';

/**
 * Public, unauthenticated onboarding flow: a client redeeming an invite has
 * no credentials yet — that's the point of this flow — so nothing here can
 * be mounted behind apiKeyAuth or adminAuth (see src/index.ts / src/testApp.ts,
 * which mount this router outside both guards, alongside the public admin
 * login route). Rate-limited with its own IP-keyed limiter, deliberately
 * separate from the admin login limiter, so a burst of onboarding traffic
 * can never lock out operator login (see H-1 in the whole-branch review).
 */
const router = Router();
router.use(onboardingLimiter);

const VISIBLE_RUC_DIGITS = 4;

/**
 * Masks all but the last few digits of a RUC for the unauthenticated invite
 * preview endpoint — an attacker with a guessed/leaked invite token should
 * not learn the full RUC of the tenant it belongs to.
 */
const maskRuc = (ruc: string): string => {
  if (ruc.length <= VISIBLE_RUC_DIGITS) return ruc;
  return '*'.repeat(ruc.length - VISIBLE_RUC_DIGITS) + ruc.slice(-VISIBLE_RUC_DIGITS);
};

router.get('/invite/:token', async (req, res) => {
  try {
    const tokenHash = hashInviteToken(req.params.token);
    const invite = await Invite.findOne({ token_hash: tokenHash });

    if (!invite) {
      return res.json({ valid: false, reason: 'not_found' });
    }
    if (invite.used_at) {
      return res.json({ valid: false, reason: 'used' });
    }
    if (invite.expires_at.getTime() <= Date.now()) {
      return res.json({ valid: false, reason: 'expired' });
    }

    const company = await IssuingCompany.findById(invite.empresa_emisora_id);
    if (!company) {
      return res.json({ valid: false, reason: 'not_found' });
    }

    return res.json({
      valid: true,
      company: {
        razon_social: company.razon_social,
        nombre_comercial: company.nombre_comercial,
        ruc: maskRuc(company.ruc),
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

const completeOnboardingSchema = z.object({
  token: z.string().min(1),
  certificate: z.string().min(1),
  certificate_password: z.string().min(1),
  contact_email: z.string().email().optional(),
});

/**
 * Verifies a P12 certificate (received as base64 in the request body, not
 * yet encrypted) actually opens with the given password, by materializing
 * it to a short-lived temp file. Mirrors
 * src/routes/issuingCompany.ts#verifyIncomingP12 (Phase 3's PUT /certificate)
 * — duplicated rather than shared, since it's ~15 lines of straightforward
 * temp-file plumbing and this keeps that already-reviewed route untouched.
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

router.post('/complete', async (req, res) => {
  const parsed = completeOnboardingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid onboarding data', errors: parsed.error.issues });
  }

  const { token, certificate, certificate_password: certificatePassword, contact_email: contactEmail } = parsed.data;

  try {
    // Verify the P12 opens BEFORE consuming the invite: a wrong password
    // must not burn the tenant's only invite token.
    const verification = await verifyIncomingP12(certificate, certificatePassword);
    if (!verification.valid) {
      return res.status(400).json({ message: `Invalid P12 certificate: ${verification.error}` });
    }

    const tokenHash = hashInviteToken(token);
    const now = new Date();

    // Atomic single-use consumption: a plain findOne-then-save would let two
    // concurrent completions both read used_at: null and both succeed.
    const invite = await Invite.findOneAndUpdate(
      { token_hash: tokenHash, used_at: null, expires_at: { $gt: now } },
      { used_at: now },
    );
    if (!invite) {
      return res.status(400).json({ message: 'Invalid, expired, or already used invite token' });
    }

    // `active: true` in the filter makes the write conditional: a tenant
    // suspended via PUT /admin/api/tenants/:id/active (fraud, non-payment)
    // must not be able to redeem a still-live invite to overwrite its stored
    // certificate or mint a new ApiKey — apiKeyAuth already rejects that
    // tenant's keys, but nothing upstream of this route previously stopped
    // it from *writing* here. This does the existence + active check and the
    // update as a single atomic operation, so there's no separate
    // read-then-write race window.
    const company = await IssuingCompany.findOneAndUpdate(
      { _id: invite.empresa_emisora_id, active: true },
      {
        certificate: encrypt(certificate),
        certificate_password: encrypt(certificatePassword),
        onboarded_at: now,
        ...(contactEmail ? { email_notificacion: contactEmail } : {}),
      },
      { new: true },
    );
    if (!company) {
      // The filter above matches "not found" and "suspended" identically, so
      // a second, read-only lookup distinguishes them purely for the error
      // message -- neither branch has written anything to the tenant.
      const existingCompany = await IssuingCompany.findById(invite.empresa_emisora_id);
      if (existingCompany && !existingCompany.active) {
        return res.status(403).json({ message: 'This tenant has been suspended and cannot complete onboarding' });
      }
      return res.status(404).json({ message: 'Tenant not found' });
    }

    const { token: apiKeyToken, prefix, hash } = generateApiKey();
    const apiKey = new ApiKey({
      empresa_emisora_id: company._id,
      name: 'Onboarding',
      prefix,
      key_hash: hash,
    });
    await apiKey.save();

    // The API key's raw token is returned exactly once, here — this is the
    // credential the client walks away with; it is never displayed again.
    return res.status(201).json({
      message: 'Onboarding complete',
      api_key: apiKeyToken,
      company: {
        id: company._id,
        razon_social: company.razon_social,
        nombre_comercial: company.nombre_comercial,
        ruc: company.ruc,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
