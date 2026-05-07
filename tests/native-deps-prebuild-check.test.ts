/**
 * T1-86 / T2-35 regression guard: verify the current Electron packaging
 * decision after the native serialport bridge was removed.
 *
 * Historical note: T1-86 originally justified `npmRebuild: false` while
 * serialport was a production dependency. T2-35 removes that unused Electron
 * serial subsystem entirely, so the safer invariant is now simpler:
 *   1. no production serialport dependency is shipped,
 *   2. no native Electron serial module remains in this repo,
 *   3. npmRebuild remains false with a rationale tied to the removal.
 *
 * Run: npx tsx tests/native-deps-prebuild-check.test.ts
 */
export {};

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

interface RootPackage {
  _npmRebuildRationale?: string;
  build?: {
    npmRebuild?: boolean;
    _npmRebuildRationale?: string;
  };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readRootPackage(): RootPackage {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as RootPackage;
}

void (() => {
  console.log('\n=== native dependency packaging decision (T1-86 / T2-35) ===\n');

  const rootPkg = readRootPackage();

  assert(
    rootPkg.dependencies?.serialport === undefined,
    'package.json:dependencies does not include serialport',
  );
  assert(
    rootPkg.devDependencies?.serialport === undefined,
    'package.json:devDependencies does not include serialport',
  );
  assert(
    rootPkg.build?.npmRebuild === false,
    'package.json:build.npmRebuild === false',
  );
  assert(
    rootPkg.build?._npmRebuildRationale === undefined,
    'package.json:build has no custom _npmRebuildRationale key',
  );

  const rationale = rootPkg._npmRebuildRationale ?? '';
  assert(
    typeof rationale === 'string' && rationale.length >= 100,
    'package.json:_npmRebuildRationale is a non-trivial doc string',
  );
  assert(
    /T2-35/.test(rationale) && /T1-86/.test(rationale),
    'rationale links the old native-dep decision to the T2-35 removal',
  );
  assert(
    /serialport/i.test(rationale) && /removed/i.test(rationale),
    'rationale explains that serialport was removed rather than rebuilt',
  );
  assert(
    /no production native Node modules/i.test(rationale),
    'rationale states the current no-production-native-module invariant',
  );

  assert(
    !existsSync(join(REPO_ROOT, 'electron', 'serial.ts')),
    'electron/serial.ts is deleted',
  );
  assert(
    !existsSync(join(REPO_ROOT, 'node_modules', '@serialport', 'bindings-cpp')),
    'node_modules/@serialport/bindings-cpp is not installed',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
