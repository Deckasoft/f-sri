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
 * General limiter applied to every /api/v1 request.
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
});

/**
 * Strict limiter for the public, auth-adjacent endpoints (login and
 * onboarding/registration) that are reachable without a valid token.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
});
