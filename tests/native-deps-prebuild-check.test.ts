/**
 * T1-86 regression test: verify the structural prerequisites that justify
 * the package.json `npmRebuild: false` decision.
 *
 * Background: serialport is a native module — its bindings (the
 * @serialport/bindings-cpp subpackage) are compiled C++ that loads at
 * runtime via node-gyp-build. With Electron Builder's default
 * `npmRebuild: true`, electron-rebuild runs before packaging and rebuilds
 * native modules against the Electron version's Node ABI. The current
 * config sets `npmRebuild: false`, which skips that rebuild.
 *
 * `npmRebuild: false` is correct iff:
 *   1. The native module uses N-API (forward-compatible across runtime
 *      versions, so no per-Electron-version rebuild is needed), AND
 *   2. The package ships prebuilt binaries for our target platforms, AND
 *   3. node-gyp-build is the runtime resolver, AND
 *   4. Electron Builder packages the prebuild files into the installer
 *      (default behavior for production dependencies; .node files
 *      auto-unpack from asar).
 *
 * This test asserts (1)-(3) structurally — the package and prebuild file
 * shape — at sandbox time. (4) is verified at build time (electron-builder
 * default behavior, asar unpack). The runtime check on a packaged binary
 * (`require('serialport').SerialPort.list()` against release/win-unpacked
 * or the mac/linux equivalent) lives in T3-86 and runs in CI.
 *
 * If a future serialport upgrade drops prebuilds, switches away from
 * N-API, or restructures the prebuilds directory, this test fails and
 * forces the npmRebuild decision to be re-evaluated.
 *
 * Run: npx tsx tests/native-deps-prebuild-check.test.ts
 */
export {};

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

interface BindingsCppPackage {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
}

interface RootPackage {
  build?: {
    npmRebuild?: boolean;
    _npmRebuildRationale?: string;
  };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

void (() => {
  console.log('\n=== native deps prebuild check (T1-86) ===\n');

  // ── 1. Root package.json declares serialport as a production dep ─────
  // (Production deps get included by Electron Builder's default file
  // walker; devDeps don't. If serialport ever moves to devDependencies,
  // packaged installers would silently drop it.)
  {
    const rootPkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
    ) as RootPackage;
    assert(
      typeof rootPkg.dependencies?.serialport === 'string',
      'package.json:dependencies includes serialport (production dep)',
    );
    assert(
      rootPkg.devDependencies?.serialport === undefined,
      'serialport is NOT in devDependencies (would be skipped by builder)',
    );
  }

  // ── 2. The npmRebuild decision is documented ─────────────────────────
  // T1-86 deliverable: the rationale must be present, so a future
  // maintainer hitting "why is npmRebuild false?" can find the answer
  // without spelunking through git history.
  {
    const rootPkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
    ) as RootPackage;
    assert(
      rootPkg.build?.npmRebuild === false,
      'package.json:build.npmRebuild === false (current decision)',
    );
    const rationale = rootPkg.build?._npmRebuildRationale ?? '';
    assert(
      typeof rationale === 'string' && rationale.length >= 100,
      'package.json:build._npmRebuildRationale is a non-trivial doc string',
    );
    assert(
      /T1-86/.test(rationale),
      'rationale references T1-86 so the source of the decision is discoverable',
    );
    assert(
      /N-API|n-api|node-addon-api/i.test(rationale),
      'rationale names N-API as the basis for forward compatibility',
    );
    assert(
      /prebuild/i.test(rationale),
      'rationale mentions prebuilds (the runtime mechanism)',
    );
  }

  // ── 3. @serialport/bindings-cpp is installed and uses N-API ──────────
  // N-API (via node-addon-api) is what justifies skipping the rebuild —
  // without it, every Electron version bump would need a fresh rebuild
  // because V8's ABI changes.
  const bindingsCppDir = join(REPO_ROOT, 'node_modules', '@serialport', 'bindings-cpp');
  {
    assert(
      existsSync(bindingsCppDir),
      'node_modules/@serialport/bindings-cpp is installed',
    );
    const bindingsPkg = JSON.parse(
      readFileSync(join(bindingsCppDir, 'package.json'), 'utf8'),
    ) as BindingsCppPackage;
    assert(
      typeof bindingsPkg.dependencies?.['node-addon-api'] === 'string',
      'bindings-cpp depends on node-addon-api (N-API surface)',
    );
    assert(
      typeof bindingsPkg.dependencies?.['node-gyp-build'] === 'string',
      'bindings-cpp depends on node-gyp-build (runtime prebuild resolver)',
    );
  }

  // ── 4. Prebuilds exist for target platforms ──────────────────────────
  // The prebuild filename varies (e.g. @serialport+bindings-cpp.node,
  // or with N-API ABI tag). We assert at least one .node file in each
  // expected platform directory rather than matching exact filenames,
  // so the test stays robust across bindings-cpp versions.
  const prebuildsDir = join(bindingsCppDir, 'prebuilds');
  {
    assert(
      existsSync(prebuildsDir) && statSync(prebuildsDir).isDirectory(),
      'prebuilds/ directory present',
    );

    const requiredPlatforms = [
      'win32-x64',
      'darwin-x64+arm64',
      'linux-x64',
    ];

    for (const plat of requiredPlatforms) {
      const platDir = join(prebuildsDir, plat);
      const platDirExists = existsSync(platDir) && statSync(platDir).isDirectory();
      assert(platDirExists, `prebuilds/${plat}/ exists`);
      if (platDirExists) {
        const files = readdirSync(platDir);
        const nodeBinaries = files.filter(f => f.endsWith('.node'));
        assert(
          nodeBinaries.length >= 1,
          `prebuilds/${plat}/ contains at least one .node binary (got ${nodeBinaries.length})`,
        );
      }
    }
  }

  // ── 5. Electron is a devDependency, version >= 34 (matches N-API ABI we tested) ──
  // The N-API forward-compatibility argument depends on the runtime
  // supporting the N-API version that bindings-cpp was built against.
  // Electron 34 supports N-API 9; bindings-cpp uses N-API ≤ 8 (via
  // node-addon-api 8.x). Document this here so the test fails if the
  // Electron major drops below the supported floor (unlikely, but).
  {
    const rootPkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
    ) as RootPackage;
    const electronSpec = rootPkg.devDependencies?.electron ?? '';
    assert(
      /^[\^~]?(?:3[4-9]|[4-9]\d|\d{3,})\b/.test(electronSpec),
      `devDependencies.electron is >= 34 (got "${electronSpec}")`,
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
