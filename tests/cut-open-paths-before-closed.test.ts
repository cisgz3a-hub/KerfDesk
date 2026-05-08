/**
 * T3-29: open paths on a cut operation should run before closed cutouts.
 * Run: npx tsx tests/cut-open-paths-before-closed.test.ts
 */
import {
  createEmptyJob,
  flatPathFromPoints,
  type FlatPath,
  type Operation,
  type ResolvedLaserSettings,
} from '../src/core/job/Job';
import { optimizePlan } from '../src/core/plan/PlanOptimizer';
import { EMPTY_OFFSET_TABLE } from '../src/core/plan/ScanningOffset';
import { generateId, type Point } from '../src/core/types';

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

const baseSettings: ResolvedLaserSettings = {
  powerMin: 0,
  powerMax: 80,
  speed: 1000,
  passes: 1,
  zStepPerPass: 0,
  fillInterval: 0.1,
  fillAngle: 0,
  fillMode: 'line',
  fillBiDirectional: true,
  overscanning: 0,
  overcut: 0,
  leadIn: 0,
  tabCount: 0,
  tabWidth: 0,
  insideFirst: true,
  airAssist: false,
  accelAwarePower: false,
  maxAccelMmPerS2: 500,
  minPowerRatioAccel: 0.1,
  scanningOffsets: EMPTY_OFFSET_TABLE,
};

function squarePath(id: string, x: number, y: number, size: number): FlatPath {
  return flatPathFromPoints([
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ], true, id);
}

function openPath(id: string, from: Point, to: Point): FlatPath {
  return flatPathFromPoints([from, to], false, id);
}

function planMarkerIds(paths: FlatPath[], insideFirst: boolean): string[] {
  const job = createEmptyJob('T3-29 cut ordering', 'test');
  const op: Operation = {
    id: generateId(),
    layerId: 'cut-layer',
    layerName: 'Cut',
    layerColor: '#f00',
    order: 0,
    type: 'cut',
    settings: { ...baseSettings, insideFirst },
    geometry: { type: 'vector', paths },
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  };
  job.operations.push(op);
  const plan = optimizePlan(job);
  return plan.operations[0].moves
    .filter(move => move.type === 'marker')
    .map(move => move.sourceObjectIds.join(','));
}

console.log('\n=== cut open paths before closed paths ===\n');

{
  const ids = planMarkerIds([
    squarePath('outer-cutout', 0, 0, 100),
    openPath('open-score', { x: 10, y: 10 }, { x: 90, y: 10 }),
    squarePath('inner-cutout', 40, 40, 20),
  ], true);
  assert(ids.join(' > ') === 'open-score > inner-cutout > outer-cutout',
    `open score runs before inside-first closed cutouts (got ${ids.join(' > ')})`);
}

{
  const ids = planMarkerIds([
    squarePath('near-closed-cutout', 0, 0, 10),
    openPath('far-open-score', { x: 80, y: 80 }, { x: 90, y: 80 }),
  ], false);
  assert(ids.join(' > ') === 'far-open-score > near-closed-cutout',
    `open score still runs before closed cutout when insideFirst is disabled (got ${ids.join(' > ')})`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
