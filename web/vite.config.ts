import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `base` must match the server's WEB_APP_MOUNT_PATH — the bundle is served from
 * the API's own origin under /app so the session cookie stays first-party.
 *
 * In development the dev server proxies /api and /auth to the Express server for
 * the same reason: the browser must see one origin, or Safari drops the cookie.
 */
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:5000';

export default defineConfig({
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
      '/auth': { target: API_TARGET, changeOrigin: false },
    },
  },
});
