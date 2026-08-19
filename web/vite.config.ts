import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In browser dev the frontend runs on :5173 and proxies /api to the Node
// backend on :8787. In Electron prod the server (:8787) also serves the built
// assets from dist/, so the same relative /api paths work without a proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
