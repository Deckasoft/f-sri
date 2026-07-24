// Declaration merging for Express's Request type. This file must stay a
// module (hence the `export {}`) for `declare global` to augment the
// ambient `Express` namespace rather than shadowing it.
export {};

declare global {
  namespace Express {
    interface Request {
      /**
       * Populated by src/middleware/apiKeyAuth.ts (kind: 'apiKey') for
       * /api/v1/* requests, or src/middleware/adminAuth.ts (kind: 'admin')
       * for /admin/api/* requests. Undefined on routes neither middleware
       * has run on (e.g. the admin login endpoint itself).
       */
      auth?: { kind: 'apiKey'; companyId: string; apiKeyId: string } | { kind: 'admin'; userId: string };
    }
  }
}
