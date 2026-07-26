import crypto from 'crypto';

/**
 * Shared secret-token primitives used by both API keys
 * (src/utils/apiKey.utils.ts) and invite tokens (src/utils/invite.utils.ts):
 * both are `${prefix}` followed by 32 random bytes (base64url-encoded), and
 * both are looked up later by the SHA-256 hex digest of the full token
 * rather than the raw secret, so only the digest is ever persisted. This is
 * genuinely the same operation with a different prefix, so it's factored out
 * here instead of being duplicated in each caller.
 */

/** SHA-256 hex digest of a value, used as the persisted, lookup-by-equality form of a secret token. */
export const sha256Hex = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

/** `${prefix}` + 32 random bytes, base64url-encoded. */
export const generateRandomToken = (prefix: string): string =>
  `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
