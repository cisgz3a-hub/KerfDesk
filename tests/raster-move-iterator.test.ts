/**
 * T3-34 raster move iterator slice.
 * Run: npx tsx tests/raster-move-iterator.test.ts
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createEmptyJob,
  type Operation,
  type ProcessedBitmap,
  type ResolvedLaserSettings,
} from '../src/core/job/Job';
import {
  iterateRasterOperationMoves,
  optimizePlan,
} from '../src/core/plan/PlanOptimizer';
import { EMPTY_OFFSET_TABLE } from '../src/core/plan/ScanningOffset';

let passed = 0;
let failed = 0;

function check(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

const settings: ResolvedLaserSettings = {
  powerMin: 0,
  powerMax: 70,
  speed: 1200,
  passes: 1,
  zStepPerPass: 0,
  fillInterval: 0.1,
  fillAngle: 0,
  fillMode: 'line',
  fillBiDirectional: true,
  overscanning: 0.5,
  overcut: 0,
  leadIn: 0,
  tabCount: 0,
  tabWidth: 0,
  insideFirst: false,
  airAssist: false,
  accelAwarePower: false,
  maxAccelMmPerS2: 1000,
  minPowerRatioAccel: 0.1,
  scanningOffsets: EMPTY_OFFSET_TABLE,
};

const bitmap: ProcessedBitmap = {
  width: 5,
  height: 4,
  dpi: 254,
  sourceObjectId: 'bitmap-a',
  mode: '1bit',
  data: new Uint8Array([
    1, 1, 0, 1, 1,
    0, 0, 0, 0, 0,
    1, 1, 1, 0, 0,
    0, 1, 1, 1, 0,
  ]),
  physicalWidth: 5,
  physicalHeight: 4,
  position: { x: 10, y: 20 },
  pipeline: {
    brightness: 0,
    contrast: 0,
    gamma: 1,
    ditheringMode: 'threshold',
    inverted: false,
  },
};

console.log('\n=== T3-34 raster operation move iterator ===');

{
  const job = createEmptyJob('Raster iterator parity', 'test');
  const operation: Operation = {
    id: 'op-raster',
    layerId: 'layer-raster',
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
  job.operations.push(operation);

  const plannedMoves = optimizePlan(job).operations[0].moves
    .filter(move => move.type !== 'marker');
  const iteratedMoves = Array.from(iterateRasterOperationMoves(bitmap, settings));

  assert.deepEqual(iteratedMoves, plannedMoves);
  check(true, 'iterateRasterOperationMoves matches optimizePlan raster moves after marker removal');
  check(iteratedMoves[0]?.type === 'laserOn', 'iterator emits the modal laserOn first');
  check(iteratedMoves[iteratedMoves.length - 1]?.type === 'laserOff', 'iterator emits the modal laserOff last');
  check(iteratedMoves.some(move => move.type === 'rapid'), 'iterator emits scanline rapid moves');
  check(iteratedMoves.some(move => move.type === 'linear' && move.power === 0), 'iterator preserves S0 approach/gap/exit linears');
  check(iteratedMoves.some(move => move.type === 'linear' && move.power > 0), 'iterator preserves powered burn linears');
}

{
  const blankBitmap: ProcessedBitmap = {
    ...bitmap,
    sourceObjectId: 'blank-bitmap',
    data: new Uint8Array(bitmap.width * bitmap.height),
  };
  const moves = Array.from(iterateRasterOperationMoves(blankBitmap, settings));
  assert.deepEqual(moves, []);
  check(true, 'blank raster iterator emits no laserOn/laserOff wrapper');
}

{
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, '../src/core/plan/PlanOptimizer.ts'), 'utf-8');

  check(
    /export function\* iterateRasterOperationMoves/.test(src),
    'PlanOptimizer exports the lazy raster operation move iterator',
  );
  check(
    /for \(const rasterMove of iterateRasterOperationMoves\(operation\.geometry\.bitmap,\s*settings,\s*signal\)\)/.test(src),
    'planOperation consumes raster moves directly from the iterator',
  );
  check(
    !/const rasterMoves = planRasterOperation/.test(src),
    'planOperation no longer builds a private rasterMoves array before appending',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
