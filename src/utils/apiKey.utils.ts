import crypto from 'crypto';

export const API_KEY_PREFIX = 'sk_live_';
const PREFIX_DISPLAY_LENGTH = 12;

export interface GeneratedApiKey {
  /** Raw token — only ever returned to the caller at creation time. */
  token: string;
  /** First ~12 characters of the token, safe to store/display later. */
  prefix: string;
  /** SHA-256 hex digest of the token — what actually gets persisted. */
  hash: string;
}

/**
 * SHA-256 hex digest of an API key token. Used both to generate a new key's
 * stored hash and to look up an incoming request's key by equality, so no
 * per-request bcrypt cost is paid on the hot invoicing path.
 */
export const hashApiKey = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Generates a new API key: `sk_live_` followed by 32 random bytes,
 * base64url-encoded. Returns the raw token (never stored, only handed back
 * to the caller once), its display prefix, and its stored hash.
 */
export const generateApiKey = (): GeneratedApiKey => {
  const token = `${API_KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  return {
    token,
    prefix: token.slice(0, PREFIX_DISPLAY_LENGTH),
    hash: hashApiKey(token),
  };
};
