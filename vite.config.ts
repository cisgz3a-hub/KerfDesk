import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      // npm "main" points to missing lib/; use published sources
      'potrace-js': path.resolve(__dirname, 'node_modules/potrace-js/src/index.js'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
