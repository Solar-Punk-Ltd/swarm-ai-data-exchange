import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': '{}',
  },
  resolve: {
    alias: [
      // Catch `dotenv` and any subpath import like `dotenv/config`
      {
        find: /^dotenv(\/.*)?$/,
        replacement: path.resolve(__dirname, 'src/mocks/dotenv.ts'),
      },
      {
        find: '@solarpunk/erc8004-adapter',
        replacement: path.resolve(__dirname, '../erc8004-adapter/src/index.ts'),
      },
    ],
  },
  build: {
    rollupOptions: {
      // bee-js uses Node crypto and is never needed in the browser
      external: ['@ethersphere/bee-js'],
    },
  },
});
