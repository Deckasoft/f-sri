import { Request } from 'express';

/**
 * Thrown when getTenantCompanyId is called on a request that never went
 * through apiKeyAuth. Every /api/v1/* route is mounted behind apiKeyAuth
 * (see src/index.ts and src/testApp.ts), which always sets
 * req.auth = { kind: 'apiKey', ... } on success — so in normal operation this
 * is never thrown. It exists purely as a defensive invariant check, not a
 * client-facing error path: callers should let it bubble into their
 * route-level try/catch, which reports it as a 500 like any other
 * unexpected server error.
 */
export class MissingTenantError extends Error {
  constructor() {
    super('Request is missing an authenticated API-key tenant');
    this.name = 'MissingTenantError';
  }
}

/**
 * Extracts the authenticated tenant's companyId from req.auth, narrowing the
 * `{ kind: 'apiKey' } | { kind: 'admin' }` discriminated union without any
 * `as`/`as any` casts. Every /api/v1/* route handler that needs to scope a
 * query to "the caller's own company" should go through this helper rather
 * than reading req.auth directly.
 */
export const getTenantCompanyId = (req: Request): string => {
  if (req.auth?.kind !== 'apiKey') {
    throw new MissingTenantError();
  }
  return req.auth.companyId;
};
