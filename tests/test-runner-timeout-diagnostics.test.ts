/**
 * T1-241: full-suite runner diagnostics.
 *
 * Run: npx tsx tests/test-runner-timeout-diagnostics.test.ts
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  not ok - ${message}`);
  }
}

console.log('\n=== T1-241 test runner timeout diagnostics ===\n');

const root = process.cwd();
const runnerPath = resolve(root, 'scripts/run-tests.mjs');
const runnerSource = readFileSync(runnerPath, 'utf-8');

assert(/DEFAULT_TEST_TIMEOUT_MS/.test(runnerSource), 'runner defines a default per-file timeout');
assert(/LASERFORGE_TEST_TIMEOUT_MS/.test(runnerSource), 'runner timeout can be configured by environment');
assert(/--timeout-ms/.test(runnerSource), 'runner timeout can be configured by CLI flag');
assert(/function runTestFile/.test(runnerSource), 'runner executes each file through a timeout-aware helper');
assert(/'--import', tsxImportSpecifier/.test(runnerSource), 'runner uses Node with the tsx import loader');
assert(/const testPath = `tests\/\$\{file\}`/.test(runnerSource), 'runner passes a repo-relative test path to tsx');
assert(/timed out after/.test(runnerSource), 'timeout message names the stuck test file');
assert(/taskkill/.test(runnerSource), 'Windows timeout cleanup kills the child process tree');
assert(/Child PID/.test(runnerSource), 'timeout diagnostics include the child PID');

const help = spawnSync(process.execPath, [runnerPath, '--help'], {
  cwd: root,
  encoding: 'utf-8',
});
assert(help.status === 0, '--help exits 0');
assert(
  `${help.stdout}\n${help.stderr}`.includes('--timeout-ms=<ms>'),
  '--help documents the per-file timeout option',
);

const invalid = spawnSync(process.execPath, [runnerPath, '--timeout-ms=0', '--list'], {
  cwd: root,
  encoding: 'utf-8',
});
assert(invalid.status !== 0, 'invalid timeout exits non-zero');
assert(
  `${invalid.stdout}\n${invalid.stderr}`.includes('positive integer'),
  'invalid timeout explains the expected value',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
