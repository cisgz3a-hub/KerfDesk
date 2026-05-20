/**
 * F45-11-001: ticket-only/start-style raster planning must not materialize
 * every raster move before the output spool can help.
 *
 * Run: npx tsx tests/large-raster-plan-lazy-materialization.test.ts
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import {
  createEmptyJob,
  type Operation,
  type ProcessedBitmap,
  type ResolvedLaserSettings,
} from '../src/core/job/Job';
import { GrblOutputStrategy } from '../src/core/output/GrblStrategy';
import { collectStreamingOutput } from '../src/core/output/GcodeStreaming';
import { applyMachineTransform } from '../src/core/plan/MachineTransform';
import {
  iteratePlannedOperationMoves,
  optimizePlan,
} from '../src/core/plan/PlanOptimizer';
import { EMPTY_OFFSET_TABLE } from '../src/core/plan/ScanningOffset';

let passed = 0;
let failed = 0;

function check(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  OK ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const settings: ResolvedLaserSettings = {
  powerMin: 0,
  powerMax: 65,
  speed: 1800,
  passes: 1,
  zStepPerPass: 0,
  fillInterval: 0.1,
  fillAngle: 0,
  fillMode: 'line',
  fillBiDirectional: true,
  overscanning: 0.25,
  overcut: 0,
  leadIn: 0,
  tabCount: 0,
  tabWidth: 0,
  insideFirst: false,
  airAssist: true,
  accelAwarePower: false,
  maxAccelMmPerS2: 1000,
  minPowerRatioAccel: 0.1,
  scanningOffsets: EMPTY_OFFSET_TABLE,
};

const bitmap: ProcessedBitmap = {
  width: 12,
  height: 8,
  dpi: 254,
  sourceObjectId: 'large-raster-lazy-source',
  mode: '1bit',
  data: new Uint8Array(12 * 8),
  physicalWidth: 12,
  physicalHeight: 8,
  position: { x: 4, y: 6 },
  pipeline: {
    brightness: 0,
    contrast: 0,
    gamma: 1,
    ditheringMode: 'threshold',
    inverted: false,
    imageMode: 'threshold',
    imageThreshold: 128,
  },
};

for (let y = 0; y < bitmap.height; y++) {
  for (let x = 0; x < bitmap.width; x++) {
    bitmap.data[y * bitmap.width + x] = x % 2 === 0 ? 255 : 0;
  }
}

function makeRasterJob(): ReturnType<typeof createEmptyJob> {
  const job = createEmptyJob('Lazy raster materialization', 'test');
  const op: Operation = {
    id: 'op-large-raster-lazy',
    layerId: 'layer-large-raster-lazy',
    layerName: 'Image',
    layerColor: '#f0b429',
    order: 0,
    type: 'raster',
    settings,
    geometry: { type: 'raster', bitmap },
    bounds: {
      minX: bitmap.position.x,
      minY: bitmap.position.y,
      maxX: bitmap.position.x + bitmap.physicalWidth,
      maxY: bitmap.position.y + bitmap.physicalHeight,
    },
  };
  job.operations.push(op);
  job.bounds = { ...op.bounds };
  job.metadata.objectCount = 1;
  job.metadata.layerCount = 1;
  return job;
}

async function collectGcode(plan: ReturnType<typeof optimizePlan>, job: ReturnType<typeof makeRasterJob>): Promise<readonly string[]> {
  const strategy = new GrblOutputStrategy();
  const streamed = await collectStreamingOutput(
    strategy.generateGcode(plan, job, {
      chunkLines: 9,
      startMode: 'absolute',
      returnPosition: null,
      maxSpindle: 1000,
      clock: () => '2026-05-20T00:00:00.000Z',
    }),
  );
  return streamed.lines;
}

console.log('\n=== F45-11-001 large raster lazy plan materialization ===\n');

void (async () => {
  const job = makeRasterJob();
  const fullPlan = optimizePlan(job);
  const lazyPlan = optimizePlan(job, { deferRasterMoveMaterialization: true } as any);

  const fullOp = fullPlan.operations[0];
  const lazyOp = lazyPlan.operations[0];
  assert(fullOp != null && lazyOp != null);

  const fullMoves = fullOp.moves;
  const lazyMoves = Array.from(iteratePlannedOperationMoves(lazyOp));

  check(fullMoves.length > 50, `fixture produces enough raster moves to expose materialization (${fullMoves.length})`);
  check(lazyOp.moves.length < fullMoves.length / 4, `lazy raster op keeps only bounded prefix/tail moves (${lazyOp.moves.length} vs ${fullMoves.length})`);
  assert.deepEqual(lazyMoves, fullMoves);
  check(true, 'lazy move iterator preserves exact raster move order and content');
  check(
    lazyMoves[lazyMoves.length - 2]?.type === 'laserOff' &&
      lazyMoves[lazyMoves.length - 1]?.type === 'setAir',
    'lazy sequence preserves air-assist tail after raster laserOff',
  );
  check(lazyPlan.stats.moveCount === fullPlan.stats.moveCount, 'lazy plan stats count deferred raster moves');
  assert.deepEqual(lazyPlan.bounds, fullPlan.bounds);
  check(true, 'lazy plan bounds match materialized plan bounds');

  const fullMachinePlan = applyMachineTransform(fullPlan, {
    startMode: 'absolute',
    savedOrigin: null,
    originCorner: 'rear-left',
    bedHeightMm: 300,
    bedWidthMm: 400,
  }).plan;
  const lazyMachinePlan = applyMachineTransform(lazyPlan, {
    startMode: 'absolute',
    savedOrigin: null,
    originCorner: 'rear-left',
    bedHeightMm: 300,
    bedWidthMm: 400,
  }).plan;

  check(
    lazyMachinePlan.operations[0].moves.length < fullMachinePlan.operations[0].moves.length / 4,
    'machine transform preserves lazy raster materialization boundary',
  );
  assert.deepEqual(await collectGcode(lazyMachinePlan, job), await collectGcode(fullMachinePlan, job));
  check(true, 'lazy machine plan emits the same streamed GRBL output as the materialized plan');
  const pipelineSrc = readFileSync('src/app/PipelineService.ts', 'utf8');
  check(
    /deferRasterMoveMaterialization:\s*gcodeMaterialization === 'ticket-only'/.test(pipelineSrc),
    'ticket-only compile path requests deferred raster move materialization',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
