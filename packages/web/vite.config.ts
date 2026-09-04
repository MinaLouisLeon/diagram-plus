import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * The editor is built straight into the server package's `public/` directory,
 * so `dgp` serves it with no extra wiring. In development it proxies the API
 * to a `dgp` instance running on the default port.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../server/public'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 4518,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4517', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:4517', ws: true },
    },
  },
});
