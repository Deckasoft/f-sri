import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by Express both at /admin (backoffice) and /onboarding (public
// onboarding page) from the SAME built dist/ directory — see
// src/staticSpa.ts. base: '/admin/' makes every built asset URL absolute
// (e.g. /admin/assets/index-xxxx.js); since Express also serves that same
// dist/ directory's static assets under the /admin prefix, those asset URLs
// resolve correctly even when index.html itself was served from /onboarding.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    proxy: {
      '/admin/api': 'http://localhost:3000',
      '/onboarding/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
  },
});
