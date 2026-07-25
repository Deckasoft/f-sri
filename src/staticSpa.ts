import fs from 'fs';
import path from 'path';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';

/**
 * Serves a built Vite SPA (the admin/ backoffice + public onboarding page,
 * see admin/) at `mountPath`, with client-side-router fallback: any GET
 * request under `mountPath` that isn't a static asset file resolves to
 * `index.html`, so deep links into the SPA's client-side routes (e.g.
 * /admin/tenants/123 or /onboarding?token=...) work on a hard refresh.
 *
 * MUST be mounted AFTER the API routers for the same prefix (e.g.
 * adminAuthRoutes/adminRoutes at /admin/api, onboardingRoutes at
 * /onboarding/api) — see src/index.ts and src/testApp.ts. Express tries
 * middleware/routes in registration order, and any of those routers that
 * matches and sends a response (including a 401 from the adminAuth guard)
 * ends the request there; this fallback is only ever reached for requests
 * those routers didn't already handle. The `req.path.startsWith('/api')`
 * guard below is defense in depth for the one gap that ordering alone
 * doesn't close: a sub-path under `${mountPath}/api` that no admin/
 * onboarding route matches (a typo'd endpoint, say) would otherwise fall
 * through to this handler and incorrectly get served the SPA's HTML instead
 * of a 404.
 *
 * No-ops entirely (returns false, mounts nothing) if `distDir/index.html`
 * doesn't exist. `admin/dist` is Vite build output and is gitignored — it
 * is absent on a fresh checkout and in CI unless `admin` has been built, and
 * mounting static-serving middleware unconditionally would either throw or
 * 404 every request in that case. src/testApp.ts (used by the Jest suite)
 * relies on this no-op: it wires this same function in so the SPA-serving
 * code path is exercised by the same app factory as production, without
 * requiring every test run to first build the SPA.
 */
export const mountSpaFallback = (app: Express, mountPath: string, distDir: string): boolean => {
  const indexHtmlPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    return false;
  }

  // redirect: false — serve-static's default behavior 301-redirects a
  // directory-shaped request (e.g. bare "/admin") to add a trailing slash
  // before serving its index.html. That's irrelevant here (this app.use
  // mount already IS the "directory" for every sub-path) and would
  // needlessly redirect the bare mount path instead of serving the SPA
  // shell directly.
  app.use(mountPath, express.static(distDir, { redirect: false }));

  app.get([mountPath, `${mountPath}/*`], (req: Request, res: Response, next: NextFunction) => {
    const subPath = req.path.slice(mountPath.length) || '/';
    if (subPath.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(indexHtmlPath);
  });

  return true;
};
