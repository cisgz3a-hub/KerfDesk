import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // T2-105: hidden renderer maps support crash symbolication while keeping
    // the runtime bundle free of //# sourceMappingURL references. The maps
    // are generated in dist/ for post-build tooling, then excluded from
    // packaged installers by package.json:build.files negation globs.
    sourcemap: 'hidden',
  },
  server: {
    port: 3000,
    open: true,
  },
});
