import { loadEnv } from '../../src/config/env.config';

describe('env.config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns the validated variables when everything is present and well-formed', () => {
    const env = loadEnv();

    expect(env.JWT_SECRET).toBe(process.env.JWT_SECRET);
    expect(env.ENCRYPTION_KEY).toBe(process.env.ENCRYPTION_KEY);
    expect(env.MONGO_URI).toBe(process.env.MONGO_URI);
    expect(env.PUBLIC_URL).toBe(process.env.PUBLIC_URL);
  });

  it('fails fast when JWT_SECRET is missing (the empty-string fallback bug this replaces)', () => {
    delete process.env.JWT_SECRET;

    expect(() => loadEnv()).toThrow(/JWT_SECRET/);
  });

  it('fails fast when ENCRYPTION_KEY is not 64 hex characters', () => {
    process.env.ENCRYPTION_KEY = 'not-a-valid-key';

    expect(() => loadEnv()).toThrow(/ENCRYPTION_KEY/);
  });

  it('fails fast when MONGO_URI is missing', () => {
    delete process.env.MONGO_URI;

    expect(() => loadEnv()).toThrow(/MONGO_URI/);
  });

  it('fails fast when PUBLIC_URL is missing', () => {
    delete process.env.PUBLIC_URL;

    expect(() => loadEnv()).toThrow(/PUBLIC_URL/);
  });

  it('fails fast when PUBLIC_URL is not a valid URL', () => {
    process.env.PUBLIC_URL = 'not-a-url';

    expect(() => loadEnv()).toThrow(/PUBLIC_URL/);
  });
});
