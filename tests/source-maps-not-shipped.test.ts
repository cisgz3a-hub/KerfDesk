/**
 * T1-83 regression test: configuration files declare the no-source-maps-in-
 * shipped-installers policy.
 *
 * Bug: source maps in the Electron main-process and renderer outputs leak
 * the original variable names, file structure, and (depending on emit mode)
 * the original source content of the entitlement code, controller logic,
 * and any logic relying on T1-77's stopgap secret-removal. A reverse
 * engineer with the installer can read the source nearly verbatim.
 *
 * Fix: three configuration changes.
 *  1. package.json build.files adds negation globs for *.map files in dist
 *     and dist-electron — Electron Builder skips maps when packaging.
 *  2. vite.config.ts explicitly sets build.sourcemap to false — guards
 *     against future config drift.
 *  3. electron/tsconfig.json:compilerOptions.sourceMap stays true (per the
 *     roadmap's preferred Option B): local devs keep maps for debugging,
 *     but the package-level negation prevents shipping them.
 *
 * This test audits all three configuration files. If a future change
 * removes the negation globs, removes the explicit sourcemap setting, or
 * sets the Electron sourceMap to a non-boolean, the test catches it before
 * a tainted build ships.
 *
 * Run: npx tsx tests/source-maps-not-shipped.test.ts
 */
export {};

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

interface PackageJson {
  build?: { files?: string[] };
}

interface ElectronTsconfig {
  compilerOptions?: { sourceMap?: unknown };
}

void (() => {
  console.log('\n=== source maps not shipped (T1-83) ===\n');

  // ── 1. package.json:build.files contains the four expected entries ────
  {
    const raw = readFileSync(join(REPO_ROOT, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as PackageJson;
    const files = pkg.build?.files ?? [];

    assert(
      files.includes('dist/**/*'),
      'package.json:build.files includes "dist/**/*"',
    );
    assert(
      files.includes('!dist/**/*.map'),
      'package.json:build.files includes "!dist/**/*.map" (renderer maps excluded)',
    );
    assert(
      files.includes('dist-electron/**/*'),
      'package.json:build.files includes "dist-electron/**/*"',
    );
    assert(
      files.includes('!dist-electron/**/*.map'),
      'package.json:build.files includes "!dist-electron/**/*.map" (main-process maps excluded)',
    );

    // Order matters in glob negation: the negation must come AFTER the
    // inclusive pattern that matches the same path. Verify ordering.
    const distIdx = files.indexOf('dist/**/*');
    const distNegIdx = files.indexOf('!dist/**/*.map');
    assert(
      distIdx >= 0 && distNegIdx > distIdx,
      'dist/**/* negation comes after the inclusive pattern (glob ordering correct)',
    );
    const electronIdx = files.indexOf('dist-electron/**/*');
    const electronNegIdx = files.indexOf('!dist-electron/**/*.map');
    assert(
      electronIdx >= 0 && electronNegIdx > electronIdx,
      'dist-electron/**/* negation comes after the inclusive pattern (glob ordering correct)',
    );
  }

  // ── 2. vite.config.ts has explicit sourcemap setting ──────────────────
  {
    const text = readFileSync(join(REPO_ROOT, 'vite.config.ts'), 'utf8');
    // Accept either `sourcemap: false` (no maps anywhere) OR
    // `sourcemap: 'hidden'` (maps generated but no //# sourceMappingURL
    // reference in the bundle — used if a crash reporter ever needs them).
    // Reject `sourcemap: true` (full maps shipped, the original bug).
    const sourcemapFalse = /sourcemap:\s*false\b/.test(text);
    const sourcemapHidden = /sourcemap:\s*['"]hidden['"]/.test(text);
    const sourcemapTrue = /sourcemap:\s*true\b/.test(text);
    assert(
      sourcemapFalse || sourcemapHidden,
      'vite.config.ts sets build.sourcemap to false or "hidden"',
    );
    assert(
      !sourcemapTrue,
      'vite.config.ts does NOT set build.sourcemap to true (full maps would ship)',
    );
  }

  // ── 3. electron/tsconfig.json sourceMap is a boolean ──────────────────
  // Both true and false are acceptable per the roadmap:
  //  - true: local devs keep maps; package.json files glob excludes them.
  //  - false: maps never generated. Equally safe.
  // This test guards against accidental string assignment or removal.
  {
    const raw = readFileSync(join(REPO_ROOT, 'electron', 'tsconfig.json'), 'utf8');
    const cfg = JSON.parse(raw) as ElectronTsconfig;
    const v = cfg.compilerOptions?.sourceMap;
    assert(
      typeof v === 'boolean',
      `electron/tsconfig.json compilerOptions.sourceMap is a boolean (got: ${typeof v})`,
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
