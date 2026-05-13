/**
 * T3-66: the test runner exposes stable suite lanes for CI and local triage.
 *
 * Run: npx tsx tests/test-runner-lanes.test.ts
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

type PackageJson = {
  scripts?: Record<string, string>;
};

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  not ok - ${message}`);
  }
}

console.log('\n=== T3-66 test runner lanes ===\n');

const root = process.cwd();
const runnerPath = resolve(root, 'scripts/run-tests.mjs');
const packageJsonPath = resolve(root, 'package.json');
const runnerSource = readFileSync(runnerPath, 'utf-8');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;

assert(/T3-66/.test(runnerSource), 'runner documents the T3-66 lane split');
assert(/LANE_DEFINITIONS/.test(runnerSource), 'runner has explicit lane definitions');
assert(/--lane/.test(runnerSource), 'runner accepts a --lane option');
assert(/--list/.test(runnerSource), 'runner can list selected tests without running them');
assert(/--timeout-ms/.test(runnerSource), 'runner accepts a per-file timeout option');

assert(
  packageJson.scripts?.['test'] === 'node scripts/run-tests.mjs',
  'npm test remains the all-tests command',
);
assert(
  packageJson.scripts?.['test:unit'] === 'node scripts/run-tests.mjs --lane=unit',
  'package.json exposes test:unit',
);
assert(
  packageJson.scripts?.['test:output'] === 'node scripts/run-tests.mjs --lane=output',
  'package.json exposes test:output',
);
assert(
  packageJson.scripts?.['test:sim'] === 'node scripts/run-tests.mjs --lane=sim',
  'package.json exposes test:sim',
);
assert(
  packageJson.scripts?.['test:perf'] === 'node scripts/run-tests.mjs --lane=perf',
  'package.json exposes test:perf',
);

const cliIsAvailable =
  /T3-66/.test(runnerSource) &&
  /LANE_DEFINITIONS/.test(runnerSource) &&
  /--lane/.test(runnerSource) &&
  /--list/.test(runnerSource);

function listLane(lane: string): string[] {
  const result = spawnSync(process.execPath, [runnerPath, `--lane=${lane}`, '--list'], {
    cwd: root,
    encoding: 'utf-8',
  });
  assert(result.status === 0, `--lane=${lane} --list exits 0`);
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

if (cliIsAvailable) {
  const unit = listLane('unit');
  const output = listLane('output');
  const sim = listLane('sim');
  const transportSim = listLane('transport-sim');
  const controllerSim = listLane('controller-sim');
  const perf = listLane('perf');

  assert(output.some((file) => file.startsWith('e2e/')), 'output lane includes E2E golden tests');
  assert(output.includes('e2e-semantic-assertions.test.ts'), 'output lane includes semantic E2E assertions');
  assert(output.every((file) => file.startsWith('e2e/') || file === 'e2e-semantic-assertions.test.ts'), 'output lane is limited to output/golden tests');

  assert(transportSim.includes('web-serial-byte-stream-harness.test.ts'), 'transport-sim includes fake WebSerial harness');
  assert(transportSim.includes('falcon-wifi-fake-server.test.ts'), 'transport-sim includes fake Falcon WiFi server');
  assert(transportSim.includes('serial-navigator-disconnect.test.ts'), 'transport-sim includes Web Serial disconnect recovery');
  assert(controllerSim.some((file) => file.startsWith('simulators/')), 'controller-sim includes simulator fixture tests');
  assert(sim.includes('web-serial-byte-stream-harness.test.ts'), 'sim alias includes transport-sim files');
  assert(sim.some((file) => file.startsWith('simulators/')), 'sim alias includes controller-sim files');

  assert(perf.length > 0, 'perf lane is not empty');
  assert(perf.every((file) => file.startsWith('perf/')), 'perf lane is limited to tests/perf');

  assert(unit.length > 0, 'unit lane is not empty');
  assert(unit.every((file) => !file.startsWith('e2e/')), 'unit lane excludes E2E golden tests');
  assert(!unit.includes('e2e-semantic-assertions.test.ts'), 'unit lane excludes semantic E2E assertions');
  assert(unit.every((file) => !file.startsWith('perf/')), 'unit lane excludes perf/stress tests');
  assert(!unit.includes('web-serial-byte-stream-harness.test.ts'), 'unit lane excludes fake WebSerial harness');
  assert(!unit.includes('falcon-wifi-fake-server.test.ts'), 'unit lane excludes fake Falcon WiFi server');
} else {
  assert(false, 'runner CLI lane checks skipped because --lane/--list support is missing');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
