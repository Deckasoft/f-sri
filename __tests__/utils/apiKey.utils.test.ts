import crypto from 'crypto';
import { API_KEY_PREFIX, generateApiKey, hashApiKey } from '../../src/utils/apiKey.utils';

describe('apiKey.utils', () => {
  describe('generateApiKey', () => {
    it('produces a token with the sk_live_ prefix', () => {
      const { token } = generateApiKey();
      expect(token.startsWith(API_KEY_PREFIX)).toBe(true);
    });

    it('produces a different token on every call', () => {
      const first = generateApiKey();
      const second = generateApiKey();
      expect(first.token).not.toBe(second.token);
      expect(first.hash).not.toBe(second.hash);
    });

    it('derives prefix as the first 12 characters of the token', () => {
      const { token, prefix } = generateApiKey();
      expect(prefix).toBe(token.slice(0, 12));
      expect(prefix.length).toBe(12);
    });

    it('derives hash as the sha256 hex digest of the token', () => {
      const { token, hash } = generateApiKey();
      const expected = crypto.createHash('sha256').update(token).digest('hex');
      expect(hash).toBe(expected);
    });

    it('never returns the raw token as part of the hash', () => {
      const { token, hash } = generateApiKey();
      expect(hash).not.toContain(token);
      expect(hash).toHaveLength(64); // sha256 hex digest length
    });
  });

  describe('hashApiKey', () => {
    it('is deterministic for the same input', () => {
      expect(hashApiKey('sk_live_abc')).toBe(hashApiKey('sk_live_abc'));
    });

    it('produces different hashes for different inputs', () => {
      expect(hashApiKey('sk_live_abc')).not.toBe(hashApiKey('sk_live_def'));
    });
  });
});
