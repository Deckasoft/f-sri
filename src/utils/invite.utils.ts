import { generateRandomToken, sha256Hex } from './token.utils';

export const INVITE_TOKEN_PREFIX = 'inv_';

/** Invites expire 7 days after creation. */
export const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export interface GeneratedInvite {
  /** Raw token — only ever returned to the admin at creation time. */
  token: string;
  /** SHA-256 hex digest of the token — what actually gets persisted as Invite.token_hash. */
  hash: string;
}

/**
 * SHA-256 hex digest of an invite token. Same custody pattern as
 * hashApiKey: only the digest is ever persisted, so an atomic
 * findOneAndUpdate by this digest is what actually redeems an invite.
 */
export const hashInviteToken = (token: string): string => sha256Hex(token);

/**
 * Generates a new invite token: `inv_` followed by 32 random bytes,
 * base64url-encoded. Returns the raw token (never stored, only handed back
 * to the admin once, at creation) and its stored hash.
 */
export const generateInviteToken = (): GeneratedInvite => {
  const token = generateRandomToken(INVITE_TOKEN_PREFIX);
  return { token, hash: hashInviteToken(token) };
};

/** Computes the expiry Date for an invite created now. */
export const computeInviteExpiry = (): Date => new Date(Date.now() + INVITE_EXPIRY_MS);
