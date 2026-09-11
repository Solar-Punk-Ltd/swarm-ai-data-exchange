import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  /**
   * Routes are real paths (`/map`, `/claim-wallet`), so every unknown path must serve index.html.
   * `appType: 'spa'` is the default and both `vite dev` and `vite preview` do it already — but a
   * static host will not unless configured. See "Hosting" in CLAUDE.md before deploying.
   *
   * Serving from a sub-path needs `base` here and nothing else: the router reads and writes every
   * path through `import.meta.env.BASE_URL`.
   */
  appType: 'spa',
  // erc8004-dashboard occupies the default 5173, and root `pnpm dev` runs both in parallel.
  server: { port: 5174 },
  resolve: {
    alias: [
      // Run against SDK source so the app needs no build step from `packages/contracts`.
      {
        find: '@solarpunk/contracts',
        replacement: path.resolve(__dirname, '../contracts/ts/index.ts'),
      },
    ],
  },
});
