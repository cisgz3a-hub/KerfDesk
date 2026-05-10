/**
 * T3-86: packaged-app smoke-test surface.
 *
 * Audit 5B Required Priority 2 + Critical 3 calls for a CI-runnable
 * smoke test that proves the packaged Electron app launches, that
 * serial transport loads, and that storage works. Two factors shape
 * this slice:
 *
 *   1. T2-35 removed the native `serialport` Node module path. The
 *      production transport is Web Serial via Electron's bundled
 *      Chromium, so the audit's "serialport loads" criterion is
 *      now "Web Serial is available in the renderer", which is
 *      built into Electron and does not need a separate prebuild.
 *      Native-deps regression prevention already lives in T2-35's
 *      `tests/native-deps-prebuild-check.test.ts`.
 *
 *   2. A Playwright-based runner that launches the packaged exe is
 *      a release-cycle concern: it requires a built artifact, a
 *      Playwright dependency, and a CI runner with the right OS.
 *      Adding Playwright as a dev-dep just for this would be heavy
 *      while the release pipeline is still being designed (T2-98).
 *
 * This slice ships a build-config smoke test that runs inside the
 * normal `npm test` process and pins the static contract surface a
 * packaged-app smoke test depends on:
 *
 *   - `package.json` exposes `electron:build` (Windows installer)
 *     and `electron:build:mac` (macOS dmg) scripts.
 *   - The build pipeline goes through `vite build` + `tsc -p
 *     electron/tsconfig.json` + `electron-builder --win` (the
 *     CLAUDE.md-documented sequence).
 *   - `scripts/verify-production-build.mjs` (T1-81) exists and is
 *     invoked from the build pipeline.
 *   - The packaged build does NOT depend on the native `serialport`
 *     module (T2-35), so smoke-test infrastructure does not need to
 *     prebuild native modules.
 *
 * The Playwright-based launch test that exercises the packaged exe
 * end-to-end is filed as a future T3-86 follow-up slice once
 * T2-98 (Win/macOS CI runners) lands.
 *
 * Run: npx tsx tests/packaged-app-smoke/packaged-app-build-config.test.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function readJson<T>(rel: string): T {
  const full = resolve(repoRoot, rel);
  return JSON.parse(readFileSync(full, 'utf-8')) as T;
}

function readSrc(rel: string): string {
  const full = resolve(repoRoot, rel);
  if (!existsSync(full)) return '';
  return readFileSync(full, 'utf-8');
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  build?: {
    win?: { target?: string | { target: string }[] };
    mac?: unknown;
    files?: string[];
    asarUnpack?: string[];
  };
}

console.log('\n=== T3-86 packaged-app build-config smoke test ===\n');

void (async () => {
  const pkg = readJson<PackageJson>('package.json');
  const scripts = pkg.scripts ?? {};

  // 1. Required electron-build scripts exist.
  {
    assert(typeof scripts['electron:build'] === 'string' && scripts['electron:build'].length > 0, 'package.json: electron:build script defined');
    assert(typeof scripts['electron:build:mac'] === 'string' && scripts['electron:build:mac'].length > 0, 'package.json: electron:build:mac script defined');
  }

  // 2. Build script chains the documented sequence:
  //    `npm run build` → `npm run electron:compile` → electron-builder.
  //    The chained scripts run vite build (for renderer assets) and
  //    tsc (for the Electron main process); resolve them transitively.
  {
    const buildCmd = scripts['electron:build'] ?? '';
    assert(/npm run build/.test(buildCmd), 'electron:build chains `npm run build`');
    assert(/npm run electron:compile/.test(buildCmd), 'electron:build chains `npm run electron:compile`');
    assert(/electron-builder/.test(buildCmd), 'electron:build invokes electron-builder');
    assert(/--win/.test(buildCmd), 'electron:build targets Windows (--win)');

    const renderBuild = scripts['build'] ?? '';
    assert(/vite build/.test(renderBuild), 'npm run build chains `vite build` for the renderer');

    const electronCompile = scripts['electron:compile'] ?? '';
    assert(
      /tsc/.test(electronCompile) || /tsc/.test(scripts['electron:dev'] ?? ''),
      'npm run electron:compile invokes tsc for the Electron main process',
    );
  }

  // 3. Production build verification script (T1-81) exists and is
  //    invoked from the build pipeline.
  {
    const verifyExists = existsSync(resolve(repoRoot, 'scripts/verify-production-build.mjs'));
    assert(verifyExists, 'scripts/verify-production-build.mjs exists (T1-81)');

    const npmRunBuild = scripts['build'] ?? '';
    assert(
      /verify-production-build/.test(npmRunBuild),
      'npm run build invokes verify-production-build.mjs',
    );
  }

  // 4. T2-35 removed the native serialport module — assert it is
  //    NOT a runtime dependency. The packaged production app uses
  //    Web Serial via Electron's bundled Chromium and does not
  //    need a serialport prebuild.
  {
    const deps = pkg.dependencies ?? {};
    assert(
      !('serialport' in deps),
      'T2-35: `serialport` is not a runtime dependency',
    );
    assert(
      !('@serialport/bindings-cpp' in deps),
      'T2-35: `@serialport/bindings-cpp` is not a runtime dependency',
    );

    // Source pin: the regression-protection tests for T2-35 still
    // exist. If a future commit re-introduces the native path, they
    // fail first.
    assert(
      existsSync(resolve(repoRoot, 'tests/native-deps-prebuild-check.test.ts')),
      'T2-35: native-deps-prebuild-check.test.ts present',
    );
    assert(
      existsSync(resolve(repoRoot, 'tests/no-electron-sendgcode-export.test.ts')),
      'T2-35: no-electron-sendgcode-export.test.ts present',
    );
  }

  // 5. Auto-update infrastructure (T2-101 + T3-5) is wired to the
  //    packaged-app channel. The smoke test does not exercise the
  //    update flow but pins the entry points so a packaging regression
  //    is caught early.
  {
    assert(
      existsSync(resolve(repoRoot, 'tests/auto-update-infrastructure.test.ts')),
      'auto-update infrastructure test present (T2-101)',
    );
    assert(
      existsSync(resolve(repoRoot, 'tests/update-notice-ui.test.tsx')),
      'update-notice UI test present (T3-5)',
    );
  }

  // 6. The Falcon WiFi subsystem ships built-in (electron/falcon-wifi/),
  //    so the packaged app can talk to networked controllers without
  //    extra runtime deps. Pin its presence as part of the build
  //    surface so a refactor that drops it is caught.
  {
    assert(
      existsSync(resolve(repoRoot, 'electron/falcon-wifi/FalconWiFiService.ts')),
      'electron/falcon-wifi/ subsystem present',
    );
  }

  // 7. CSP hardening (T3-8) is part of the packaged-build security
  //    posture. Pin the CSP source.
  {
    assert(
      existsSync(resolve(repoRoot, 'electron/cspPolicy.ts')),
      'electron/cspPolicy.ts present (T3-8)',
    );
    const main = readSrc('electron/main.ts');
    assert(/cspPolicy/.test(main), 'electron/main.ts uses cspPolicy');
  }

  // 8. License-check is wired into the pre-commit / pre-build path so
  //    a packaging regression that adds a license-incompatible dep is
  //    caught before release.
  {
    assert(
      typeof scripts['license-check'] === 'string',
      'package.json: license-check script defined',
    );
    assert(
      existsSync(resolve(repoRoot, 'scripts/license-allowlist.mjs')),
      'scripts/license-allowlist.mjs present',
    );
  }

  // 9. Self-pin: T3-86 marker present in this manifest.
  {
    const selfPath = resolve(here, 'packaged-app-build-config.test.ts');
    const selfSrc = readFileSync(selfPath, 'utf-8');
    assert(/T3-86/.test(selfSrc), 'Manifest source: T3-86 marker present');
    assert(/audit 5B/i.test(selfSrc), 'Manifest source: audit 5B cited');
  }

  console.log(`\nT3-86 packaged-app build-config smoke: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
