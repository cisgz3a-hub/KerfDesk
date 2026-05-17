/**
 * Regression for machines that visibly burn/cut raster gap bridges emitted as
 * `G1 ... S0` under modal M4. Zero-power linear travel must be protected by a
 * real laser-off command so blank image regions cannot become connector marks.
 *
 * Run: npx tsx tests/gcode-hard-off-zero-power-travel.test.ts
 */
import { createEmptyJob } from '../src/core/job/Job';
import { createEmptyPlan } from '../src/core/plan/Plan';
import { GrblOutputStrategy } from '../src/core/output/GrblStrategy';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function executableLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith(';'));
}

console.log('\n=== zero-power raster travel uses hard laser-off ===\n');

const job = createEmptyJob('hard-off-zero-power-travel', 'test-project');
job.operations = [{
  id: 'op-raster-gap',
  layerId: 'layer-raster',
  layerName: 'Raster',
  layerColor: '#000000',
  order: 0,
  type: 'raster',
  settings: {
    powerMin: 0,
    powerMax: 80,
    speed: 1200,
    passes: 1,
    zStepPerPass: 0,
    fillInterval: 0,
    fillAngle: 0,
    fillMode: 'line',
    fillBiDirectional: false,
    overscanning: 0,
    overcut: 0,
    leadIn: 0,
    tabCount: 0,
    tabWidth: 0,
    insideFirst: false,
    airAssist: false,
    accelAwarePower: false,
    maxAccelMmPerS2: 500,
    minPowerRatioAccel: 0.2,
    scanningOffsets: [],
  },
  geometry: { type: 'raster', bitmap: null },
  bounds: { minX: 0, minY: 0, maxX: 60, maxY: 1 },
} as any];
job.metadata.objectCount = 1;
job.metadata.layerCount = 1;

const plan = createEmptyPlan(job.id);
plan.operations = [{
  operationId: 'op-raster-gap',
  layerName: 'Raster',
  layerColor: '#000000',
  passIndex: 0,
  moves: [
    { type: 'laserOn', power: 0 },
    { type: 'rapid', to: { x: 0, y: 0 } },
    { type: 'linear', to: { x: 10, y: 0 }, power: 80, speed: 1200 },
    { type: 'linear', to: { x: 50, y: 0 }, power: 0, speed: 1200 },
    { type: 'linear', to: { x: 60, y: 0 }, power: 80, speed: 1200 },
    { type: 'laserOff' },
  ],
}];
plan.bounds = { minX: 0, minY: 0, maxX: 60, maxY: 1 };
plan.stats = {
  totalDistanceMm: 60,
  rapidDistanceMm: 0,
  cutDistanceMm: 60,
  estimatedTimeSeconds: 3,
  moveCount: plan.operations[0].moves.length,
  operationCount: 1,
  passCount: 1,
};

const strategy = new GrblOutputStrategy();
const output = strategy.generate(plan, job, {
  clock: () => '2026-05-17T00:00:00.000Z',
});

const lines = executableLines(output.text ?? '');
const gapIdx = lines.findIndex(line => /^G1\b.*\bX50\.000\b.*\bY0\.000\b/.test(line));
const nextBurnIdx = lines.findIndex(line => /^G1\b.*\bX60\.000\b.*\bY0\.000\b/.test(line));

assert(gapIdx >= 0, 'zero-power gap travel line is present');
assert(nextBurnIdx > gapIdx, 'burn resumes after the zero-power gap travel');

if (gapIdx >= 0) {
  assert(/^M5\s+S0\b/i.test(lines[gapIdx - 1] ?? ''), 'gap travel is preceded by hard M5 S0 laser-off');
  assert(!/\bS0\b/i.test(lines[gapIdx] ?? ''), 'gap travel itself does not rely on inline S0');
  assert(/^M4\s+S0\b/i.test(lines[gapIdx + 1] ?? ''), 'modal M4 is restored at S0 only after the safe travel completes');
}

if (nextBurnIdx >= 0) {
  assert(/\bS800\b/i.test(lines[nextBurnIdx] ?? ''), 'next burn segment still carries the expected S-value');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
