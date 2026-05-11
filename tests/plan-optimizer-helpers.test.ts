/**
 * T1-149: regression test for the pure helpers extracted from
 * PlanOptimizer. These helpers feed into the planner's
 * nearest-neighbor ordering, position tracking, and post-plan AABB
 * computation — all load-bearing for correct head-travel between
 * paths and for the framing rectangle the operator sees before Start.
 *
 * Run: npx tsx tests/plan-optimizer-helpers.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FlatPath } from '../src/core/job/Job';
import type { Move, Plan } from '../src/core/plan/Plan';
import {
  computePlanBounds,
  distanceSq,
  getFinalPosition,
  getFinalPositionFromMoves,
  getLastOrderedPathEndpoint,
  getPathEnd,
  getPathEndpoint,
  getPathStart,
  orderWithBestDirection,
} from '../src/core/plan/planOptimizerHelpers';

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

function flatPath(coords: number[], closed: boolean): FlatPath {
  return { coords, closed } as unknown as FlatPath;
}

console.log('\n=== T1-149 PlanOptimizer helpers ===\n');

// -------- distanceSq --------
{
  assert(distanceSq({ x: 0, y: 0 }, { x: 3, y: 4 }) === 25,
    'distanceSq((0,0),(3,4)) = 25');
  assert(distanceSq({ x: 1, y: 1 }, { x: 1, y: 1 }) === 0,
    'distanceSq same point = 0');
}

// -------- getPathStart / getPathEnd --------
{
  const p = flatPath([0, 0, 10, 0, 10, 5], false);
  const start = getPathStart(p);
  assert(start.x === 0 && start.y === 0,
    'getPathStart returns first {x,y} pair');
  const end = getPathEnd(p);
  assert(end.x === 10 && end.y === 5,
    'getPathEnd returns last {x,y} pair');
}

// -------- getPathEndpoint: open path --------
{
  const p = flatPath([0, 0, 10, 5], false);
  // Not reversed: head ends at end
  const e1 = getPathEndpoint(p, false);
  assert(e1.x === 10 && e1.y === 5,
    'open path forward → end = (10,5)');
  // Reversed: head ends at start
  const e2 = getPathEndpoint(p, true);
  assert(e2.x === 0 && e2.y === 0,
    'open path reversed → ends at start (0,0)');
}

// -------- getPathEndpoint: closed path --------
{
  const p = flatPath([0, 0, 10, 0, 10, 10, 0, 10, 0, 0], true);
  // Closed paths return to start regardless of direction.
  // For non-reversed: head ends at start (the path returns there).
  const e1 = getPathEndpoint(p, false);
  assert(e1.x === 0 && e1.y === 0,
    'closed path forward → returns to start');
  const e2 = getPathEndpoint(p, true);
  assert(e2.x === 0 && e2.y === 0,
    'closed path reversed → also returns to start (same point in either direction)');
}

// -------- orderWithBestDirection --------
{
  const p1 = flatPath([0, 0, 10, 0], false); // start=(0,0), end=(10,0)
  const p2 = flatPath([50, 0, 60, 0], false); // start=(50,0), end=(60,0)
  // Starting at (0,0): p1 starts closer → not reversed; ends at (10,0)
  // Then p2: (10,0) → start (50,0) closer than end (60,0) → not reversed
  const r = orderWithBestDirection([p1, p2], { x: 0, y: 0 });
  assert(r.length === 2, '2 paths → 2 ordered entries');
  assert(!r[0].reversed, 'p1 forward when starting at (0,0)');
  assert(!r[1].reversed, 'p2 forward when current is (10,0)');
}

// -------- orderWithBestDirection: empty input --------
{
  const r = orderWithBestDirection([], { x: 0, y: 0 });
  assert(r.length === 0, 'empty paths → empty ordered list');
}

// -------- orderWithBestDirection: chooses reverse when end is closer --------
{
  const p = flatPath([100, 0, 0, 0], false); // start=(100,0), end=(0,0)
  // Starting at (0,0): end=(0,0) is closer → reversed
  const r = orderWithBestDirection([p], { x: 0, y: 0 });
  assert(r[0].reversed, 'chooses reverse direction when end is closer to startPos');
}

// -------- getLastOrderedPathEndpoint --------
{
  const fallback = { x: 99, y: 99 };
  assert(getLastOrderedPathEndpoint([], fallback) === fallback,
    'empty ordered list → fallback returned');

  const p = flatPath([1, 2, 5, 6], false);
  const r = getLastOrderedPathEndpoint([{ path: p, reversed: false }], fallback);
  assert(r.x === 5 && r.y === 6,
    'non-empty → endpoint of last ordered path');
}

// -------- getFinalPositionFromMoves --------
{
  const moves: Move[] = [
    { type: 'rapid', to: { x: 10, y: 20 } } as Move,
    { type: 'laserOn' } as Move,
    { type: 'linear', to: { x: 30, y: 40 } } as Move,
    { type: 'laserOff' } as Move,
  ];
  const r = getFinalPositionFromMoves(moves);
  assert(r != null && r.x === 30 && r.y === 40,
    'walks backwards, finds last linear move (30,40)');

  // No motion moves → null
  const noMotion: Move[] = [{ type: 'laserOn' } as Move, { type: 'laserOff' } as Move];
  assert(getFinalPositionFromMoves(noMotion) === null,
    'no motion moves → null');
}

// -------- getFinalPosition --------
{
  // Empty operations
  assert(JSON.stringify(getFinalPosition([])) === '{"x":0,"y":0}',
    'no operations → (0,0) origin fallback');

  const ops = [{ moves: [{ type: 'linear', to: { x: 7, y: 8 } } as Move] }];
  const r = getFinalPosition(ops);
  assert(r.x === 7 && r.y === 8,
    'returns endpoint of last operation');

  // Last operation has no positional moves
  const opsNoPos = [
    { moves: [{ type: 'linear', to: { x: 1, y: 2 } } as Move] },
    { moves: [{ type: 'laserOn' } as Move] },
  ];
  const r2 = getFinalPosition(opsNoPos);
  assert(r2.x === 0 && r2.y === 0,
    'last op has no positional moves → (0,0) fallback');
}

// -------- computePlanBounds --------
{
  const plan: Plan = {
    operations: [
      {
        moves: [
          { type: 'rapid', to: { x: 0, y: 0 } } as Move,
          { type: 'linear', to: { x: 100, y: 50 } } as Move,
          { type: 'laserOn' } as Move,
          { type: 'linear', to: { x: -10, y: 200 } } as Move,
        ],
      },
    ],
  } as unknown as Plan;
  const b = computePlanBounds(plan);
  assert(b.minX === -10 && b.maxX === 100,
    'plan bounds X = [-10, 100]');
  assert(b.minY === 0 && b.maxY === 200,
    'plan bounds Y = [0, 200]');
}

// -------- computePlanBounds: empty plan → emptyAABB sentinel --------
{
  const plan: Plan = { operations: [] } as unknown as Plan;
  const b = computePlanBounds(plan);
  // emptyAABB returns Infinity-bounded — not finite
  assert(!Number.isFinite(b.minX) || b.minX === Infinity,
    'empty plan → emptyAABB sentinel (Infinity-bounded)');
}

// -------- Source-level pin: PlanOptimizer delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const optSrc = readFileSync(
    resolve(here, '../src/core/plan/PlanOptimizer.ts'),
    'utf-8',
  );
  assert(/from '\.\/planOptimizerHelpers'/.test(optSrc),
    'PlanOptimizer imports from ./planOptimizerHelpers');
  assert(/T1-149/.test(optSrc),
    'PlanOptimizer carries T1-149 marker');
  // Each inline function definition is gone
  for (const name of [
    'getPathStart',
    'getPathEnd',
    'getPathEndpoint',
    'orderWithBestDirection',
    'getFinalPosition',
    'getFinalPositionFromMoves',
    'computePlanBounds',
    'distanceSq',
    'getLastOrderedPathEndpoint',
  ]) {
    const re = new RegExp(`^function ${name}\\b`, 'm');
    assert(!re.test(optSrc),
      `inline ${name} is gone from PlanOptimizer`);
  }

  const helperSrc = readFileSync(
    resolve(here, '../src/core/plan/planOptimizerHelpers.ts'),
    'utf-8',
  );
  assert(/T1-149/.test(helperSrc),
    'planOptimizerHelpers carries T1-149 marker');
  for (const name of [
    'distanceSq',
    'getPathStart',
    'getPathEnd',
    'getPathEndpoint',
    'orderWithBestDirection',
    'getLastOrderedPathEndpoint',
    'getFinalPosition',
    'getFinalPositionFromMoves',
    'computePlanBounds',
  ]) {
    const re = new RegExp(`export function ${name}`);
    assert(re.test(helperSrc), `${name} is exported`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
