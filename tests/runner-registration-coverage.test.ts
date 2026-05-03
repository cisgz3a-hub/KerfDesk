/**
 * T1-47: fail if a test file exists on disk but is not registered in
 * scripts/run-tests.mjs.
 *
 * Run: npx tsx tests/runner-registration-coverage.test.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

let passed = 0;
let failed = 0;

function assertContract(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

const ROOT = process.cwd();
const TESTS_DIR = resolve(ROOT, 'tests');
const RUNNER_PATH = resolve(ROOT, 'scripts/run-tests.mjs');
const TEST_FILE_PATTERN = /\.test\.tsx?$/;
const EXCLUDED_DIRS = new Set(['snapshots', 'helpers', 'fixtures', 'node_modules']);

function walkTests(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        walkTests(full, out);
      }
    } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      out.push(relative(TESTS_DIR, full).replace(/\\/g, '/'));
    }
  }
  return out;
}

console.log('\n=== T1-47 runner registration coverage ===\n');

const onDisk = walkTests(TESTS_DIR).sort();
const runnerSource = readFileSync(RUNNER_PATH, 'utf-8');
const missing = onDisk.filter(testPath => !runnerSource.includes(testPath));

assertContract(onDisk.length > 0, `walk found test files (got ${onDisk.length})`);

if (missing.length > 0) {
  console.error('\nTest files on disk but not registered in scripts/run-tests.mjs:');
  for (const testPath of missing) {
    console.error(`  ${testPath}`);
  }
  console.error('\nRegister each file or rename/remove the .test.ts(x) suffix.');
}

assertContract(
  missing.length === 0,
  `every on-disk test file is registered (found ${onDisk.length}, missing ${missing.length})`,
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
