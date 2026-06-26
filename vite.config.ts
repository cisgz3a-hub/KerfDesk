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
// `__BUILD_TIME__` — ISO timestamp of the build, in UTC.
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
        globPatterns: ['**/*.{js,css,html,svg,ico,png,json,woff,woff2}'],
        // Some bundled chunks (tracer / font libraries) exceed Workbox's 2 MB
        // default; raise the ceiling so the whole app precaches for offline use.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  // Relative asset paths so the same bundle loads via http(s):// (web deploy)
  // and file:// (Electron renderer) without rewriting URLs.
  base: './',
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
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
    // Web bundle target per PROJECT.md "Accessibility / performance": < 1 MB
    // compressed. Warn if a chunk pushes past 500 KB compressed.
    chunkSizeWarningLimit: 500,
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
