import { Request } from 'express';
import rateLimit from 'express-rate-limit';

/**
 * express-rate-limit keeps its counters in an in-memory store shared by every
 * request that hits the same limiter instance. Test suites reuse a single
 * Express app across many requests to the same routes (e.g. 14+ POST
 * /register calls in crud.routes.test.ts), so limiters must be inert during
 * tests to avoid flaking the suite; production behavior is unaffected since
 * NODE_ENV is never 'test' there.
 */
const skipInTest = (): boolean => process.env.NODE_ENV === 'test';

/**
 * Resolves the bucket key for the per-tenant /api/v1 limiter: the
 * authenticated company, not the caller's IP. tenantLimiter is mounted AFTER
 * apiKeyAuth (see src/index.ts / src/testApp.ts), which always populates
 * req.auth with kind 'apiKey' before calling next() — the 'unknown-tenant'
 * branch only exists so a future registration-order mistake degrades to a
 * shared bucket instead of throwing.
 */
const tenantKeyGenerator = (req: Request): string =>
  req.auth?.kind === 'apiKey' ? req.auth.companyId : 'unknown-tenant';

/**
 * Per-tenant limiter for every /api/v1/* request, keyed by the authenticated
 * company (req.auth.companyId) rather than the caller's IP.
 *
 * Keying on IP would be wrong here: Phase 7 put Caddy in front of this API as
 * a reverse proxy on an internal Docker network (see Caddyfile), so every
 * tenant's traffic arrives from the same proxy-container address. An
 * IP-keyed limiter would put every tenant of the platform into one shared
 * bucket — 300 unauthenticated requests from anyone would 429 the entire
 * platform for 15 minutes (whole-branch review, H-1). Keying on the tenant
 * resolved by apiKeyAuth fixes that, and requires this limiter to run AFTER
 * apiKeyAuth so req.auth is populated (see src/index.ts / src/testApp.ts).
 *
 * Limit: 1000 requests / 15 min (~66/min) per tenant. This is an invoicing
 * API called by client backend systems, not interactive browsers — it needs
 * headroom for legitimate bursts (e.g. importing a batch of invoices, a POS
 * integration retrying after a slow connection) well above what a human
 * clicking around would generate, while still bounding a runaway or
 * misconfigured integration per tenant.
 */
export const tenantLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  keyGenerator: tenantKeyGenerator,
});

/**
 * IP-based limiter for the admin backoffice login route
 * (POST /admin/api/auth/login) — genuinely unauthenticated, so there is no
 * tenant to key on yet. Deliberately a separate bucket from
 * onboardingLimiter: a burst of tenant onboarding traffic must never be able
 * to lock out operator login, and vice versa (whole-branch review, H-1).
 */
export const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
});

/**
 * IP-based limiter for the public onboarding flow (/onboarding/api/*), also
 * unauthenticated by design (see src/routes/onboarding.ts). Given a higher
 * limit than adminLoginLimiter: a legitimate onboarding session makes
 * several calls (invite preview, then complete, possibly retried after a P12
 * password typo), and — unlike admin login, which is used by a small,
 * known set of operators — several distinct tenants' staff can plausibly be
 * onboarding from behind the same NATted office IP around the same time.
 */
export const onboardingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
});
