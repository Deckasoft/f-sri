import { Request } from 'express';

/**
 * Thrown when getAdminUserId is called on a request that never went through
 * adminAuth. Every /admin/api/* route other than /admin/api/auth/login is
 * mounted behind adminAuth (see src/index.ts and src/testApp.ts), which
 * always sets req.auth = { kind: 'admin', ... } on success — so in normal
 * operation this is never thrown. It exists purely as a defensive invariant
 * check, mirroring src/utils/tenant.utils.ts#MissingTenantError.
 */
export class MissingAdminError extends Error {
  constructor() {
    super('Request is missing an authenticated admin user');
    this.name = 'MissingAdminError';
  }
}

/**
 * Extracts the authenticated admin's userId from req.auth, narrowing the
 * `{ kind: 'apiKey' } | { kind: 'admin' }` discriminated union without any
 * `as`/`as any` casts. Mirrors src/utils/tenant.utils.ts#getTenantCompanyId
 * for the admin side of the auth split.
 */
export const getAdminUserId = (req: Request): string => {
  if (req.auth?.kind !== 'admin') {
    throw new MissingAdminError();
  }
  return req.auth.userId;
};
