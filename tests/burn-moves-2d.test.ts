/**
 * Velocity-scaled 2D burn segments (appendBurnMoves2D).
 * Run: npx tsx tests/burn-moves-2d.test.ts
 */

import { type Move } from '../src/core/plan/Plan';
import { appendBurnMoves2D } from '../src/core/plan/PlanOptimizer';

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

function approx(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) <= eps;
}

console.log('\n=== appendBurnMoves2D ===\n');

{
  const moves: Move[] = [];
  appendBurnMoves2D(
    moves,
    { x: 0, y: 0 },
    { x: 0.3, y: 0 },
    500,
    1500,
    true,
    1000,
    0.1,
  );
  assert(moves.length === 1, 'short segment (≤0.5mm) is single move');
  const m0 = moves[0];
  assert(m0.type === 'linear' && m0.power === 500, 'short segment keeps commanded power');
}

{
  const moves: Move[] = [];
  appendBurnMoves2D(
    moves,
    { x: 0, y: 5 },
    { x: 100, y: 5 },
    1000,
    3000,
    true,
    1000,
    0.1,
  );
  assert(moves.length >= 2, 'long horizontal splits into multiple G1 moves');
  const powers = moves.filter(m => m.type === 'linear').map(m => (m as { power: number }).power);
  const minP = Math.min(...powers);
  const maxP = Math.max(...powers);
  assert(minP < maxP, 'horizontal burn has varying scaled power');
  const last = moves[moves.length - 1];
  assert(
    last.type === 'linear' && approx(last.to.x, 100) && approx(last.to.y, 5),
    'last move reaches segment end',
  );
}

{
  const moves: Move[] = [];
  appendBurnMoves2D(
    moves,
    { x: 0, y: 0 },
    { x: 50, y: 50 },
    1000,
    3000,
    true,
    1000,
    0.1,
  );
  assert(moves.length >= 2, '45° diagonal splits when accel-aware');
  let prev = { x: 0, y: 0 };
  for (const mv of moves) {
    if (mv.type !== 'linear') continue;
    const dx = mv.to.x - prev.x;
    const dy = mv.to.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) {
      const ux = dx / len;
      const uy = dy / len;
      assert(approx(ux, 1 / Math.SQRT2, 0.02) && approx(uy, 1 / Math.SQRT2, 0.02), 'sub-segment stays on 45° ray');
    }
    prev = mv.to;
  }
}

{
  const moves: Move[] = [];
  appendBurnMoves2D(
    moves,
    { x: 100, y: 2 },
    { x: 0, y: 2 },
    800,
    2400,
    true,
    1000,
    0.1,
  );
  assert(moves.length >= 1, 'right-to-left horizontal produces moves');
  const last = moves[moves.length - 1];
  assert(last.type === 'linear' && approx(last.to.x, 0) && approx(last.to.y, 2), 'RTL ends at start X');
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
