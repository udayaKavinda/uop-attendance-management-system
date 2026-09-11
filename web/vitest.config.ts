import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Separate from vite.config.ts on purpose: that file carries the dev-server proxy
 * and the build settings, and nothing here should be able to affect a production
 * bundle. Tests only need the React plugin (for JSX in .tsx sources) and a DOM.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    // The suite must not reach the network. Anything that tries has mocked its
    // module wrongly, and should fail loudly rather than hang on a real fetch.
    testTimeout: 5000,
  },
});
