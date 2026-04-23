/**
 * G-code comment encoding for MarkerMove.
 * Run: npx tsx tests/output-marker-encoding.test.ts
 */

import { type Plan } from '../src/core/plan/Plan';
import { createEmptyJob, type Job } from '../src/core/job/Job';
import { getOutputStrategy } from '../src/core/output/Output';
import '../src/core/output/GrblStrategy';
import { EMPTY_OFFSET_TABLE } from '../src/core/plan/ScanningOffset';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

console.log('\n=== output-marker-encoding ===');

const strategy = getOutputStrategy('grbl');
assert(!!strategy, 'GRBL strategy registered');

const job: Job = createEmptyJob('enc', 't');
const plan: Plan = {
  id: 'p1',
  jobId: job.id,
  createdAt: new Date().toISOString(),
  operations: [
    {
      operationId: 'op1',
      layerName: 'L',
      layerColor: '#fff',
      passIndex: 0,
      moves: [
        { type: 'marker', sourceObjectIds: ['obj-x'] },
        { type: 'rapid', to: { x: 0, y: 0 } },
        { type: 'laserOn', power: 50 },
        { type: 'linear', to: { x: 10, y: 0 }, power: 50, speed: 1000 },
        { type: 'laserOff' },
      ],
    },
  ],
  stats: {
    totalDistanceMm: 0,
    rapidDistanceMm: 0,
    cutDistanceMm: 0,
    estimatedTimeSeconds: 0,
    moveCount: 0,
    operationCount: 1,
    passCount: 1,
  },
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
};

job.operations.push({
  id: 'op1',
  layerId: 'l1',
  layerName: 'L',
  layerColor: '#fff',
  order: 0,
  type: 'cut',
  settings: {
    powerMin: 0,
    powerMax: 100,
    speed: 1000,
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
    minPowerRatioAccel: 0.1,
    scanningOffsets: EMPTY_OFFSET_TABLE,
  },
  geometry: { type: 'vector', paths: [] },
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
});

const out = strategy!.generate(plan, job, { maxSpindle: 1000 });
const lines = (out.text ?? '').split('\n');
const objLineIdx = lines.findIndex(l => /^;\s*OBJ\s+ids=obj-x$/i.test(l.trim()));
const g1Idx = lines.findIndex(l => l.trim().startsWith('G1') && l.includes('X10'));
assert(objLineIdx >= 0, 'OBJ comment present');
assert(g1Idx >= 0, 'G1 line present');
assert(objLineIdx < g1Idx, 'OBJ comment precedes G1');

const planMulti: Plan = {
  ...plan,
  operations: [
    {
      ...plan.operations[0],
      moves: [
        { type: 'marker', sourceObjectIds: ['a', 'b'] },
        { type: 'rapid', to: { x: 1, y: 1 } },
      ],
    },
  ],
};
const out2 = strategy!.generate(planMulti, job, { maxSpindle: 1000 });
assert(
  (out2.text ?? '').includes('; OBJ ids=a,b'),
  'multi-id encodes as ; OBJ ids=a,b',
);

console.log(`\noutput-marker-encoding: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
