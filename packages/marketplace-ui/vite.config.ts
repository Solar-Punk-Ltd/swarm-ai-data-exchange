import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
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
