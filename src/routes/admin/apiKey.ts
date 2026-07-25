import { Router } from 'express';
import { z } from 'zod';
import ApiKey from '../../models/ApiKey';
import IssuingCompany from '../../models/IssuingCompany';
import { generateApiKey } from '../../utils/apiKey.utils';
import { getAdminUserId } from '../../utils/admin.utils';

// Admin-only API key management for a tenant. Mounted at
// /admin/api/tenants/:id/api-keys, behind adminAuth. The raw token is only
// ever returned once, at creation (POST) — every other response (GET) omits
// key_hash entirely, exposing only the display prefix.
const router = Router({ mergeParams: true });

const createApiKeySchema = z.object({
  name: z.string().min(1),
});

// req.params typing note: Express's route-path-literal param inference
// (RouteParameters<Path>) infers `{}` for a literal path with no `:params`
// in it — it has no way to know mergeParams: true will merge in the
// parent router's `:id` at runtime. These generics restore that typing
// rather than reading req.params.id untyped.
interface TenantParams {
  [key: string]: string;
  id: string;
}

interface TenantApiKeyParams extends TenantParams {
  keyId: string;
}

router.get<TenantParams>('/', async (req, res) => {
  try {
    const keys = await ApiKey.find({ empresa_emisora_id: req.params.id }).select('-key_hash').sort({ createdAt: -1 });
    res.json(keys);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post<TenantParams>('/', async (req, res) => {
  const parsed = createApiKeySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid data: { name: string } required' });
  }

  try {
    const company = await IssuingCompany.findById(req.params.id);
    if (!company) return res.status(404).json({ message: 'Tenant not found' });

    const { token, prefix, hash } = generateApiKey();

    const apiKey = new ApiKey({
      empresa_emisora_id: req.params.id,
      name: parsed.data.name,
      prefix,
      key_hash: hash,
      created_by: getAdminUserId(req),
    });
    await apiKey.save();

    // token is returned exactly once, here — it is never stored (only its
    // hash is) and never displayed again after this response.
    res.status(201).json({
      id: apiKey._id,
      name: apiKey.name,
      prefix: apiKey.prefix,
      token,
      created_at: apiKey.get('createdAt'),
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete<TenantApiKeyParams>('/:keyId', async (req, res) => {
  try {
    const doc = await ApiKey.findOneAndUpdate(
      { _id: req.params.keyId, empresa_emisora_id: req.params.id },
      { revoked_at: new Date() },
      { new: true },
    ).select('-key_hash');
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
