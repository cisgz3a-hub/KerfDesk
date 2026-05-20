/**
 * F45-10-006: overcut on multi-pass closed cuts should be emitted only on
 * the final pass.
 *
 * Run: npx tsx tests/overcut-final-pass-only.test.ts
 */

import { optimizePlan } from '../src/core/plan/PlanOptimizer';
import {
  createEmptyJob,
  flatPathFromPoints,
  type Operation,
  type ResolvedLaserSettings,
} from '../src/core/job/Job';
import type { Move } from '../src/core/plan/Plan';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function nearlyEqual(actual: number, expected: number, epsilon = 1e-6): boolean {
  return Math.abs(actual - expected) <= epsilon;
}

function cutSettings(overrides: Partial<ResolvedLaserSettings> = {}): ResolvedLaserSettings {
  return {
    powerMin: 0,
    powerMax: 80,
    speed: 1200,
    passes: 2,
    zStepPerPass: 0,
    fillInterval: 0,
    fillAngle: 0,
    fillMode: 'line',
    fillBiDirectional: false,
    overscanning: 0,
    overcut: 5,
    leadIn: 0,
    tabCount: 0,
    tabWidth: 0,
    insideFirst: false,
    airAssist: false,
    accelAwarePower: false,
    maxAccelMmPerS2: 500,
    minPowerRatioAccel: 0.2,
    scanningOffsets: [],
    ...overrides,
  };
}

function squareOperation(overrides: Partial<ResolvedLaserSettings> = {}): Operation {
  const path = flatPathFromPoints(
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ],
    true,
    'overcut-square',
  );

  return {
    id: 'op-overcut',
    layerId: 'L-cut',
    layerName: 'Cut with overcut',
    layerColor: '#000000',
    order: 0,
    type: 'cut',
    settings: cutSettings(overrides),
    geometry: { type: 'vector', paths: [path] },
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
  };
}

function countOvercutMoves(moves: Move[]): number {
  return moves.filter(
    (move): move is Extract<Move, { type: 'linear' }> =>
      move.type === 'linear'
      && nearlyEqual(move.to.x, 5)
      && nearlyEqual(move.to.y, 0)
      && move.power === 80,
  ).length;
}

function planOperation(overrides: Partial<ResolvedLaserSettings> = {}) {
  const job = createEmptyJob('F45-10-006 overcut', 'test-project');
  job.operations = [squareOperation(overrides)];
  job.bounds = { minX: 0, minY: 0, maxX: 40, maxY: 40 };
  return optimizePlan(job).operations;
}

console.log('\n=== F45-10-006 overcut final pass only ===\n');

{
  const operations = planOperation({ passes: 2, overcut: 5 });
  assert(operations.length === 2, `two planned operations for two passes (got ${operations.length})`);
  assert(operations[0].passIndex === 0, 'first planned operation is pass 0');
  assert(operations[1].passIndex === 1, 'second planned operation is pass 1');
  assert(countOvercutMoves(operations[0].moves) === 0, 'pass 0 does not emit overcut');
  assert(countOvercutMoves(operations[1].moves) === 1, 'final pass emits exactly one overcut');
}

{
  const operations = planOperation({ passes: 1, overcut: 5 });
  assert(operations.length === 1, `one planned operation for one pass (got ${operations.length})`);
  assert(countOvercutMoves(operations[0].moves) === 1, 'single-pass closed cut still emits overcut once');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
