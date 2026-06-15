import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
// `__APP_VERSION__` — version field from package.json. Read at config
//   time so we don't ship the whole package.json into the bundle.
function gitShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}
function pkgVersion(): string {
  const pkgUrl = new URL('./package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the same bundle loads via http(s):// (web deploy)
  // and file:// (Electron renderer) without rewriting URLs.
  base: './',
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __GIT_SHA__: JSON.stringify(gitShortSha()),
    __APP_VERSION__: JSON.stringify(pkgVersion()),
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
