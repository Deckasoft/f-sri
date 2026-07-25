import { Router } from 'express';
import Invite from '../../models/Invite';
import IssuingCompany from '../../models/IssuingCompany';
import { generateInviteToken, computeInviteExpiry } from '../../utils/invite.utils';
import { getAdminUserId } from '../../utils/admin.utils';
import { loadEnv } from '../../config/env.config';

// Admin-only invite management for a tenant. Mounted at
// /admin/api/tenants/:id/invites, behind adminAuth. The raw invite token
// (and the ready-to-share onboarding URL built from it) is only ever
// returned once, at creation — the stored Invite document only ever holds
// its SHA-256 hash (token_hash).
const router = Router({ mergeParams: true });

const buildOnboardingUrl = (token: string): string => {
  const { PUBLIC_URL } = loadEnv();
  return `${PUBLIC_URL}/onboarding?token=${token}`;
};

// req.params typing note: see the identical comment in
// src/routes/admin/apiKey.ts — route-path-literal param inference can't see
// mergeParams: true's runtime effect, so these generics restore it.
interface TenantParams {
  [key: string]: string;
  id: string;
}

interface TenantInviteParams extends TenantParams {
  inviteId: string;
}

router.get<TenantParams>('/', async (req, res) => {
  try {
    const invites = await Invite.find({ empresa_emisora_id: req.params.id }).sort({ createdAt: -1 });
    res.json(invites);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post<TenantParams>('/', async (req, res) => {
  try {
    const company = await IssuingCompany.findById(req.params.id);
    if (!company) return res.status(404).json({ message: 'Tenant not found' });

    const { token, hash } = generateInviteToken();

    const invite = new Invite({
      empresa_emisora_id: req.params.id,
      token_hash: hash,
      expires_at: computeInviteExpiry(),
      created_by: getAdminUserId(req),
    });
    await invite.save();

    // The raw token — and the onboarding URL built from it — are returned
    // exactly once, here. Only token_hash is ever persisted.
    res.status(201).json({
      id: invite._id,
      token,
      onboarding_url: buildOnboardingUrl(token),
      expires_at: invite.expires_at,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete<TenantInviteParams>('/:inviteId', async (req, res) => {
  try {
    const doc = await Invite.findOneAndDelete({
      _id: req.params.inviteId,
      empresa_emisora_id: req.params.id,
    });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
