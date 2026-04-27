import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // T1-83: explicit no-source-maps for the renderer bundle. Default is
    // false today, but making it explicit prevents a future Vite version
    // change or accidental config addition from leaking renderer source
    // structure into end-user installers. If crash-reporter integration
    // (T2-105) ever needs maps, switch to 'hidden' (maps generated but the
    // bundle has no //# sourceMappingURL=... reference, so end users still
    // can't see the original source — only the crash uploader can).
    sourcemap: false,
  },
  server: {
    port: 3000,
    open: true,
  },
});
