/**
 * T1-226: PathOptimizer must be deterministic.
 *
 * The path order affects emitted G-code, so optimization may not depend on
 * machine speed, tab throttling, or whether `performance.now()` jumps.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { optimizePathOrder } from '../src/core/plan/PathOptimizer';
import { type FlatPath } from '../src/core/job/Job';

function makePath(id: string, x0: number, y0: number, x1: number, y1: number): FlatPath {
  return {
    id,
    coords: new Float64Array([x0, y0, x1, y1]),
    closed: false,
    direction: 'cw',
    bounds: {
      minX: Math.min(x0, x1),
      minY: Math.min(y0, y1),
      maxX: Math.max(x0, x1),
      maxY: Math.max(y0, y1),
    },
    parentId: null,
    powerScale: 1,
  };
}

function fixturePaths(): FlatPath[] {
  return [
    makePath('A', -33.7, -9.5, -17.2, 62.1),
    makePath('B', 78.5, -47.1, 40.3, -6),
    makePath('C', 38.7, 138.6, 140.1, 131.8),
    makePath('D', 149, 46.3, 11.1, 103.4),
  ];
}

function optimizeWithClockJump(jumpAfterFirstRead: boolean): string[] {
  const originalPerformance = globalThis.performance;
  const originalDateNow = Date.now;
  let nowCalls = 0;

  Object.defineProperty(globalThis, 'performance', {
    configurable: true,
    value: {
      now: () => {
        nowCalls += 1;
        return jumpAfterFirstRead && nowCalls > 1 ? 999_999 : 0;
      },
    },
  });
  Date.now = () => 0;

  try {
    return optimizePathOrder(fixturePaths(), { x: 0, y: 0 }).map(path => path.id);
  } finally {
    Object.defineProperty(globalThis, 'performance', {
      configurable: true,
      value: originalPerformance,
    });
    Date.now = originalDateNow;
  }
}

test('PathOptimizer result does not change when the wall clock jumps', () => {
  const stableClockOrder = optimizeWithClockJump(false);
  const jumpedClockOrder = optimizeWithClockJump(true);

  assert.deepEqual(jumpedClockOrder, stableClockOrder);
});

test('PathOptimizer source uses deterministic budgets instead of wall-clock caps', () => {
  const src = readFileSync('src/core/plan/PathOptimizer.ts', 'utf8');

  assert.match(src, /T1-226/);
  assert.doesNotMatch(src, /performance\.now\s*\(/);
  assert.doesNotMatch(src, /Date\.now\s*\(/);
  assert.doesNotMatch(src, /TWO_OPT_WALL_MS/);
});
