import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

import { appVersion, buildTimeIso, gitShortSha } from './src/platform/web/build-info';

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Directories Vite's dev and test transforms may read from.
 *
 * A git worktree is checked out under `<repo>/.claude/worktrees/<name>` and
 * carries its own lockfile, so Vite's workspace-root detection stops at the
 * worktree — while pnpm's real package store stays in the parent repo's
 * `node_modules`, which the worktree only symlinks into. Every `?raw` asset
 * import from a dependency then fails to load with "Denied ID", which takes
 * out every suite that renders a lucide icon.
 *
 * Allow the project plus any ancestor that actually holds a `node_modules`. On
 * an ordinary clone that resolves to the project root alone, so a normal
 * checkout keeps exactly the default access.
 */
function fileSystemAllowList(): ReadonlyArray<string> {
  const roots = [PROJECT_ROOT];
  let dir = dirname(PROJECT_ROOT);
  for (;;) {
    if (existsSync(join(dir, 'node_modules')) && !roots.includes(dir)) roots.push(dir);
    const parent = dirname(dir);
    if (parent === dir) return roots;
    dir = parent;
  }
}

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
    // false: PwaUpdateWatcher registers the SW via the virtual:pwa-register/react
    // hook (which also drives the offline-ready toast + the status-bar Update
    // button, ADR-227), and a bundled hook satisfies the strict CSP
    // (script-src 'self') where the inline registration form would be blocked.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: [
        'favicon.svg',
        'favicon-32x32.png',
        'apple-touch-icon.png',
        'app-icon-192x192.png',
        'app-icon-512x512.png',
        'app-icon-maskable-512x512.png',
      ],
      manifest: {
        name: 'KerfDesk',
        short_name: 'KerfDesk',
        description:
          'GRBL CAM for laser cutters, engravers, and CNC routers — design, trace, and burn, fully offline.',
        theme_color: '#111827',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          {
            src: 'app-icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'app-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'app-icon-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
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
          if (normalized.endsWith('/src/core/text/cnc-stroke-font-data.ts')) {
            return 'cnc-stroke-fonts';
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
    fs: { allow: [...fileSystemAllowList()] },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
