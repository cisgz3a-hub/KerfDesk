import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for the web build (ADR-003, ADR-009).
// The Electron build reuses this config via electron-builder's renderer entry
// (added when the desktop shell lands).
export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the same bundle loads via http(s):// (web deploy)
  // and file:// (Electron renderer) without rewriting URLs.
  base: './',
  build: {
    outDir: 'dist/web',
    target: 'es2022',
    sourcemap: true,
    // Web bundle target per PROJECT.md "Accessibility / performance": < 1 MB
    // compressed. Warn if a chunk pushes past 500 KB compressed.
    chunkSizeWarningLimit: 500,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
