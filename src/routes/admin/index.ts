import { Router } from 'express';
import tenantRoutes from './tenant';
import apiKeyRoutes from './apiKey';
import inviteRoutes from './invite';
import usageRoutes from './usage';

/**
 * Composes every admin sub-router (Phase 4) behind a single mount point.
 * This is NOT a barrel file (no re-exports) — it actually wires nested
 * routers together with their :id param, which is composition, not a
 * re-export index.
 *
 * Mounted at /admin/api in src/index.ts and src/testApp.ts, AFTER the
 * adminAuth guard (src/routes/admin/auth.ts's login route is mounted
 * separately, before that guard, since login must be reachable without a
 * token).
 *
 * apiKeyRoutes/inviteRoutes are mounted before tenantRoutes so their more
 * specific paths (/tenants/:id/api-keys, /tenants/:id/invites) are matched
 * first; tenantRoutes' own routes (/, /:id, /:id/active) don't overlap with
 * those longer paths, but keeping the more specific routers first is the
 * clearer, safer convention.
 */
const router = Router();

router.use('/tenants/:id/api-keys', apiKeyRoutes);
router.use('/tenants/:id/invites', inviteRoutes);
router.use('/tenants', tenantRoutes);
router.use('/', usageRoutes);

export default router;
