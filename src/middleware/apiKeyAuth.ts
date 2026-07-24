import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import ApiKey from '../models/ApiKey';
import { hashApiKey } from '../utils/apiKey.utils';

const API_KEY_HEADER = 'x-api-key';
const BEARER_PREFIX = 'Bearer ';

// Shape expected once empresa_emisora_id has been populated onto the ApiKey
// document. Validated with zod rather than trusting Mongoose's populate<>
// generics, so a dangling reference (company deleted) fails closed instead
// of producing a cast-shaped `undefined`.
const populatedCompanySchema = z.object({
  _id: z.unknown(),
  active: z.boolean(),
});

// Avoid writing last_used_at on every single request (the invoicing API can
// be called very frequently) — only touch it if it's stale by this much.
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

const extractApiKeyToken = (req: Request): string | undefined => {
  const headerKey = req.headers[API_KEY_HEADER];
  if (typeof headerKey === 'string' && headerKey.length > 0) {
    return headerKey;
  }

  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith(BEARER_PREFIX)) {
    return authorization.slice(BEARER_PREFIX.length);
  }

  return undefined;
};

const isLastUsedStale = (lastUsedAt?: Date): boolean =>
  !lastUsedAt || Date.now() - lastUsedAt.getTime() > LAST_USED_THROTTLE_MS;

/**
 * Fire-and-forget update of last_used_at, throttled so a busy key doesn't
 * write on every request. Errors are logged, not propagated — a failed
 * bookkeeping update must never fail the underlying API request.
 */
const touchLastUsed = (apiKeyId: string, lastUsedAt?: Date): void => {
  if (!isLastUsedStale(lastUsedAt)) {
    return;
  }

  ApiKey.findByIdAndUpdate(apiKeyId, { last_used_at: new Date() }).catch((err: unknown) => {
    console.error('No se pudo actualizar last_used_at de la API key', err);
  });
};

/**
 * Authenticates /api/v1/* requests via a per-tenant API key (X-API-Key
 * header, or Authorization: Bearer sk_live_...). Rejects unknown, revoked
 * keys, and keys whose owning company has been deactivated. On success,
 * populates req.auth with the resolved tenant.
 */
export const apiKeyAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = extractApiKeyToken(req);
  if (!token) {
    res.status(401).json({ message: 'API key requerida' });
    return;
  }

  try {
    const keyHash = hashApiKey(token);
    // Populate the owning company in the same round trip: this deliberately
    // avoids a second, separate IssuingCompany.findById/.findOne call, which
    // would otherwise share (and collide with) the same model's queries made
    // by the issuing-company CRUD routes for unrelated purposes.
    const apiKeyDoc = await ApiKey.findOne({ key_hash: keyHash }).populate('empresa_emisora_id');
    if (!apiKeyDoc || apiKeyDoc.revoked_at) {
      res.status(401).json({ message: 'API key inválida' });
      return;
    }

    const companyParsed = populatedCompanySchema.safeParse(apiKeyDoc.empresa_emisora_id);
    if (!companyParsed.success || !companyParsed.data.active) {
      res.status(401).json({ message: 'API key inválida' });
      return;
    }

    touchLastUsed(String(apiKeyDoc._id), apiKeyDoc.last_used_at);

    req.auth = {
      kind: 'apiKey',
      companyId: String(companyParsed.data._id),
      apiKeyId: String(apiKeyDoc._id),
    };
    next();
  } catch (err) {
    console.error('Error verificando API key', err);
    res.status(500).json({ message: 'Error del servidor' });
  }
};

export default apiKeyAuth;
