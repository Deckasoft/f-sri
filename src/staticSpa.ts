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
 * Conventionally mounted AFTER the API routers for the same prefix (e.g.
 * adminAuthRoutes/adminRoutes at /admin/api, onboardingRoutes at
 * /onboarding/api) — see src/index.ts and src/testApp.ts — for readability
 * (API routes read top-to-bottom before the catch-all SPA fallback). The
 * actual safety property doesn't depend on that order, though: the
 * `req.path.startsWith('/api')` check below makes this handler call
 * `next()` — never serve the SPA shell — for ANY sub-path under
 * `${mountPath}/api`, whether or not a real API router already handled it
 * and regardless of whether this fallback is registered before or after
 * those routers (verified directly: reordering it earlier in
 * src/testApp.ts during Phase 6 review did not change any
 * __tests__/staticSpa.test.ts result). What that check does protect
 * against, concretely: an `/admin/api/*` or `/onboarding/api/*` request
 * that no real route matches (a typo'd endpoint, or those routers being
 * accidentally dropped entirely) correctly falls through to Express's
 * default 404 instead of incorrectly getting served the SPA's HTML.
 *
 * No-ops entirely (returns false, mounts nothing) if `distDir/index.html`
 * doesn't exist. `admin/dist` is Vite build output and is gitignored — it
 * is absent on a fresh checkout and in CI unless `admin` has been built, and
 * mounting static-serving middleware unconditionally would either throw or
 * 404 every request in that case. src/testApp.ts (used by the Jest suite)
 * relies on this no-op: it wires this same function in so the SPA-serving
 * code path is exercised by the same app factory as production, without
 * requiring every test run to first build the SPA (its CreateAppOptions
 * lets a test override the dist dir with a temp fixture when it needs the
 * fallback genuinely mounted — see __tests__/staticSpa.test.ts).
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
