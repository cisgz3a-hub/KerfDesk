/**
 * T1-151: regression test for the pure top-level helpers extracted
 * from CanvasViewport (`defaultCursorForTool`, `penAfterMoveIndex`,
 * `formatTime`).
 *
 * Run: npx tsx tests/canvas-viewport-helpers.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Move } from '../src/core/plan/Plan';
import type { ToolType } from '../src/ui/components/ToolBar';
import {
  defaultCursorForTool,
  formatTime,
  penAfterMoveIndex,
} from '../src/ui/components/canvas/canvasViewportHelpers';

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

console.log('\n=== T1-151 canvas-viewport helpers ===\n');

// -------- defaultCursorForTool --------
assert(defaultCursorForTool('select' as ToolType) === 'default',
  'select → default cursor');
assert(defaultCursorForTool('node' as ToolType) === 'crosshair',
  'node → crosshair');
assert(defaultCursorForTool('rect' as ToolType) === 'crosshair',
  'rect → crosshair');
assert(defaultCursorForTool('ellipse' as ToolType) === 'crosshair',
  'ellipse → crosshair');
assert(defaultCursorForTool('line' as ToolType) === 'crosshair',
  'line → crosshair');
assert(defaultCursorForTool('text' as ToolType) === 'text',
  'text → text');
assert(defaultCursorForTool('unknown' as ToolType) === 'default',
  'unknown tool → default fallback');

// -------- penAfterMoveIndex --------
{
  const moves: Move[] = [
    { type: 'rapid', to: { x: 10, y: 20 } } as Move,
    { type: 'linear', to: { x: 30, y: 40 } } as Move,
    { type: 'laserOn' } as Move,
    { type: 'linear', to: { x: 50, y: 60 } } as Move,
  ];

  // index 0: after first rapid → (10, 20)
  const p0 = penAfterMoveIndex(moves, 0);
  assert(p0.x === 10 && p0.y === 20,
    'after moves[0] (rapid) → (10, 20)');

  // index 1: after linear → (30, 40)
  const p1 = penAfterMoveIndex(moves, 1);
  assert(p1.x === 30 && p1.y === 40,
    'after moves[1] (linear) → (30, 40)');

  // index 2: after laserOn (not positional) → unchanged (30, 40)
  const p2 = penAfterMoveIndex(moves, 2);
  assert(p2.x === 30 && p2.y === 40,
    'after laserOn → position unchanged');

  // index 3: after second linear → (50, 60)
  const p3 = penAfterMoveIndex(moves, 3);
  assert(p3.x === 50 && p3.y === 60,
    'after second linear → (50, 60)');

  // index -1: origin
  const pNeg = penAfterMoveIndex(moves, -1);
  assert(pNeg.x === 0 && pNeg.y === 0,
    'index < 0 → (0, 0) origin');

  // index past length: clamps to last
  const pOver = penAfterMoveIndex(moves, 100);
  assert(pOver.x === 50 && pOver.y === 60,
    'index > moves.length → clamps to last positional move');

  // empty moves
  const pEmpty = penAfterMoveIndex([], 0);
  assert(pEmpty.x === 0 && pEmpty.y === 0,
    'empty moves → (0, 0)');
}

// -------- penAfterMoveIndex: marker moves skipped --------
{
  const moves: Move[] = [
    { type: 'rapid', to: { x: 1, y: 2 } } as Move,
    { type: 'marker' } as unknown as Move,
    { type: 'linear', to: { x: 3, y: 4 } } as Move,
  ];
  const p = penAfterMoveIndex(moves, 2);
  assert(p.x === 3 && p.y === 4,
    'marker moves skipped, position tracked through');
}

// -------- formatTime --------
assert(formatTime(0) === '0:00.0', 'formatTime(0) = "0:00.0"');
assert(formatTime(5) === '0:05.0', 'formatTime(5) = "0:05.0"');
assert(formatTime(65) === '1:05.0', 'formatTime(65) = "1:05.0"');
assert(formatTime(125.5) === '2:05.5', 'formatTime(125.5) = "2:05.5"');
assert(formatTime(125.7) === '2:05.7', 'formatTime(125.7) = "2:05.7"');
// tenths uses floor — 0.99 → 9
assert(formatTime(0.99) === '0:00.9', 'fractional seconds → tenths digit');

// -------- Source-level pin: CanvasViewport delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const cvSrc = readFileSync(
    resolve(here, '../src/ui/components/CanvasViewport.tsx'),
    'utf-8',
  );
  assert(/from '\.\/canvas\/canvasViewportHelpers'/.test(cvSrc),
    'CanvasViewport imports from canvasViewportHelpers');
  assert(/T1-151/.test(cvSrc),
    'CanvasViewport carries T1-151 marker');
  assert(!/^function defaultCursorForTool/m.test(cvSrc),
    'inline defaultCursorForTool is gone');
  assert(!/^function penAfterMoveIndex/m.test(cvSrc),
    'inline penAfterMoveIndex is gone');
  assert(!/^function formatTime/m.test(cvSrc),
    'inline formatTime is gone');

  const helperSrc = readFileSync(
    resolve(here, '../src/ui/components/canvas/canvasViewportHelpers.ts'),
    'utf-8',
  );
  assert(/T1-151/.test(helperSrc),
    'canvasViewportHelpers carries T1-151 marker');
  for (const name of ['defaultCursorForTool', 'penAfterMoveIndex', 'formatTime']) {
    const re = new RegExp(`export function ${name}`);
    assert(re.test(helperSrc), `${name} is exported`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
