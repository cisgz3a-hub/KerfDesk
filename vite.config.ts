import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Vite config for the web build (ADR-003, ADR-009).
// The Electron build reuses this config via electron-builder's renderer entry
// (added when the desktop shell lands).

// Build-time identifiers surfaced in the Toolbar so the user can verify
// after a deploy that the new version actually loaded. None of these
// values affect the bundle's behaviour; they're cosmetic readouts.
//
// `__BUILD_TIME__` — ISO-8601 UTC timestamp of HEAD's commit (NOT wall-clock).
//   Derived from the commit so rebuilding or re-deploying the SAME commit yields a
//   byte-identical bundle. A wall-clock `new Date()` here changed the bundle (and
//   thus sw.js's precache) on every build, so every no-op redeploy / CI re-run
//   minted a fresh service worker and nagged users with a phantom "update
//   available" (ADR-060). Falls back to wall-clock only when git history is absent
//   (local dev — never deployed).
// `__GIT_SHA__` — short SHA of HEAD at build time. Falls back to
//   "dev" when git isn't available or the working dir is clean of the
//   repo (e.g. a CI scratch checkout without history).
// `__APP_VERSION__` — auto build version: package.json's MAJOR.MINOR (the
//   release line) plus the git commit count as an always-incrementing patch, so
//   the badge changes on every commit/deploy without a manual bump. Falls back
//   to the raw package.json version when git history isn't available. The deploy
//   build uses fetch-depth: 0 so the count is the real total, not a shallow 1.
function gitShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}
function gitCommitCount(): string | null {
  try {
    return execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
function buildTimeIso(): string {
  // %cI is HEAD's committer date in strict ISO-8601 (with the commit's own
  // offset). Re-normalize to UTC via Date so the value is deterministic AND keeps
  // the historical `…Z` shape. Deterministic given the commit — the whole point.
  try {
    const commitIso = execSync('git show -s --format=%cI HEAD', { encoding: 'utf8' }).trim();
    if (commitIso !== '') return new Date(commitIso).toISOString();
  } catch {
    // fall through to the dev fallback below
  }
  // Only reached without git history (local dev); such builds are never deployed,
  // so wall-clock non-determinism here is harmless.
  return new Date().toISOString();
}
function pkgVersion(): string {
  const pkgUrl = new URL('./package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}
function appVersion(): string {
  const base = pkgVersion();
  const count = gitCommitCount();
  if (count === null || count === '') return base;
  const [major = '0', minor = '0'] = base.split('.');
  return `${major}.${minor}.${count}`;
}

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
    // No sourcemaps in production builds. The repo is proprietary
    // (ADR-018) and the production URL is public — shipping the
    // .js.map would expose the full TS source incl. planning
    // comments and vendor-quirk notes (R-H3 audit finding). When a
    // Sentry-class error tracker lands, switch to `'hidden'` and
    // upload the maps server-side.
    sourcemap: false,
    // Keep individual raw chunks below Vite's 500 KB warning threshold while
    // the service worker still precaches every emitted asset for offline use.
    chunkSizeWarningLimit: 500,
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
