import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

import { appVersion, buildTimeIso, gitShortSha } from './src/platform/web/build-info';

// Vite config for the web build (ADR-003, ADR-009).
// The Electron build reuses this config via electron-builder's renderer entry
// (added when the desktop shell lands).
//
// Build-time identifiers (`__BUILD_TIME__`, `__GIT_SHA__`, `__APP_VERSION__`)
// are derived from git so re-deploying the SAME commit yields a byte-identical
// bundle (ADR-060). See src/platform/web/build-info.ts for the derivation and
// its regression tests (D-S02-001).

export default defineConfig({
  plugins: [
    react(),
    // Offline PWA (ADR-060). registerType 'prompt' (never auto-reload — see
    // ADR-060: an auto-reload could interrupt a live burn). injectRegister
    // false: PwaUpdatePrompt registers the SW via the virtual:pwa-register/react
    // hook (which also drives the offline-ready toast + the update banner), and
    // a bundled hook satisfies the strict CSP (script-src 'self') where the
    // inline registration form would be blocked.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'LaserForge 2.0',
        short_name: 'LaserForge',
        description:
          'GRBL CAM for laser cutters and engravers — design, trace, and burn, fully offline.',
        theme_color: '#2563eb',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '.',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico,png,json,ttf,woff,woff2}'],
        // Some bundled chunks and font assets exceed Workbox's 2 MB default;
        // raise the ceiling so the whole app precaches for offline use.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  // Relative asset paths so the same bundle loads via http(s):// (web deploy)
  // and file:// (Electron renderer) without rewriting URLs.
  base: './',
  define: {
    __BUILD_TIME__: JSON.stringify(buildTimeIso()),
    __GIT_SHA__: JSON.stringify(gitShortSha()),
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  build: {
    outDir: 'dist/web',
    target: 'es2022',
    // No sourcemaps in production builds: they add ~MBs to the deploy
    // for no user benefit (the source is on GitHub — ADR-120). When a
    // Sentry-class error tracker lands, switch to `'hidden'` and
    // upload the maps server-side.
    sourcemap: false,
    // Accepted chunk budget: 750 KB. The three.js relief-preview chunk
    // (three.module) is ~704 KB minified — an irreducible single vendor lib we
    // load for the CNC/relief 3D preview, so it can't be split below Vite's
    // 500 KB default. Raising the ceiling to a documented 750 KB budget keeps a
    // clean, warning-free build while still flagging any NEW oversized chunk.
    // The service worker still precaches every emitted asset for offline use.
    // A real three.js code-split is tracked as a separate refactor.
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (normalized.includes('/node_modules/react')) return 'vendor-react';
          if (normalized.includes('/node_modules/zustand')) return 'vendor-state';
          if (
            normalized.includes('/node_modules/clipper2-ts') ||
            normalized.includes('/node_modules/dompurify')
          ) {
            return 'vendor-cam';
          }
          if (normalized.includes('/src/core/')) return 'core';
          if (normalized.includes('/src/io/')) return 'io';
          if (normalized.includes('/src/ui/laser/') || normalized.includes('/src/ui/workspace/')) {
            return 'ui-workbench';
          }
          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      // Keep dev dependency pre-bundling aligned with the production build.
      // Without this, Vite's optimizer can fall back to its lower default
      // browser target and fail on modern ESM syntax in dependencies.
      target: 'es2022',
    },
  },
  worker: {
    // Trace worker imports the lazy trace pipeline, so production workers must
    // emit as ES modules. Vite's default iife worker format cannot code-split.
    format: 'es',
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
