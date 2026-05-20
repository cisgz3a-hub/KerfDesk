/**
 * F45-10-005: lead-in must start off the original cut contour, not burn
 * along the contour edge.
 *
 * Run: npx tsx tests/lead-in-off-contour.test.ts
 */

import { optimizePlan } from '../src/core/plan/PlanOptimizer';
import {
  createEmptyJob,
  flatPathFromPoints,
  type Operation,
  type ResolvedLaserSettings,
} from '../src/core/job/Job';
import type { Move } from '../src/core/plan/Plan';
import type { Point } from '../src/core/types';

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

function distancePointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(p.x - x, p.y - y);
}

function pointOnAnySquareContour(p: Point): boolean {
  const square = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 0, y: 40 },
  ];
  for (let i = 0; i < square.length; i++) {
    const a = square[i];
    const b = square[(i + 1) % square.length];
    if (distancePointToSegment(p, a, b) <= 1e-6) return true;
  }
  return false;
}

function cutSettings(overrides: Partial<ResolvedLaserSettings> = {}): ResolvedLaserSettings {
  return {
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
    leadIn: 5,
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

function squareOperation(): Operation {
  const path = flatPathFromPoints(
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ],
    true,
    'lead-in-square',
  );

  return {
    id: 'op-lead-in',
    layerId: 'L-cut',
    layerName: 'Cut with lead-in',
    layerColor: '#000000',
    order: 0,
    type: 'cut',
    settings: cutSettings(),
    geometry: { type: 'vector', paths: [path] },
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
  };
}

function firstMoveOfType<T extends Move['type']>(moves: Move[], type: T): Extract<Move, { type: T }> {
  const move = moves.find(m => m.type === type);
  if (!move) throw new Error(`Expected move type ${type}`);
  return move as Extract<Move, { type: T }>;
}

console.log('\n=== F45-10-005 lead-in starts off contour ===\n');

const job = createEmptyJob('F45-10-005 lead-in', 'test-project');
job.operations = [squareOperation()];
job.bounds = { minX: 0, minY: 0, maxX: 40, maxY: 40 };

const plan = optimizePlan(job);
const moves = plan.operations[0].moves;

const firstRapid = firstMoveOfType(moves, 'rapid');
const firstLaserOnIndex = moves.findIndex(m => m.type === 'laserOn');
const firstLinearAfterLaserOn = moves
  .slice(firstLaserOnIndex + 1)
  .find((m): m is Extract<Move, { type: 'linear' }> => m.type === 'linear');

assert(firstLaserOnIndex > moves.indexOf(firstRapid), 'laser turns on after the lead-in rapid');
assert(firstLinearAfterLaserOn !== undefined, 'lead-in burn emits a linear move after laserOn');

if (firstLinearAfterLaserOn) {
  assert(
    nearlyEqual(firstLinearAfterLaserOn.to.x, 0) && nearlyEqual(firstLinearAfterLaserOn.to.y, 0),
    `lead-in burn ends at the original start point (got ${firstLinearAfterLaserOn.to.x}, ${firstLinearAfterLaserOn.to.y})`,
  );
  assert(firstLinearAfterLaserOn.power === 80, 'lead-in burn uses cutting power');
  assert(firstLinearAfterLaserOn.speed === 1200, 'lead-in burn uses cut speed');
}

assert(
  !pointOnAnySquareContour(firstRapid.to),
  `lead-in rapid point is off the original contour (got ${firstRapid.to.x}, ${firstRapid.to.y})`,
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
