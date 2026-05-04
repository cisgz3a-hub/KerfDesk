/**
 * T1-39: in current/head mode, the frame must include the first
 * relative move from the head's current position to corners[0]. The
 * previous loop initialized `prev = corners[0]` and started at
 * `i = 1`, silently skipping the move. On front-origin diode lasers
 * (Falcon, SCULPFUN, Atomstack), `corners[0]` in machine space is
 * `(0, jobHeight)` after Y-flip, so the actual job's first move is
 * to `(0, jobHeight)`. The old frame skipped this and traced the
 * design vertically shifted by `jobHeight` — frame ≠ burn.
 *
 * On rear-origin machines, `corners[0]` typically maps to `(0, 0)`
 * so the missing move was zero-length and the bug was invisible.
 * That's why this hasn't been caught: rear-origin tests passed.
 *
 * Hardware verification needed — Falcon A1 Pro front-origin burn test.
 *
 * Run: npx tsx tests/frame-current-mode-emits-first-move.test.ts
 */
import { buildFrameCorners, buildFrameGcode } from '../src/app/frameGcode';
import type { MachineTransformOptions } from '../src/core/plan/MachineTransform';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

interface ParsedDelta {
  cmd: 'G0' | 'G1';
  x: number;
  y: number;
}

function parseDelta(line: string): ParsedDelta | null {
  const m = /^(G0|G1)\s+X(-?\d+(?:\.\d+)?)\s+Y(-?\d+(?:\.\d+)?)/.exec(line);
  if (!m) return null;
  return { cmd: m[1] as 'G0' | 'G1', x: parseFloat(m[2]), y: parseFloat(m[3]) };
}

console.log('\n=== T1-39 frame current-mode emits first move ===\n');

// ── Front-origin (front-left): the audit's exact failure case ───
{
  const sceneBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
  const transformOpts: MachineTransformOptions = {
    startMode: 'current',
    savedOrigin: null,
    originCorner: 'front-left',
    bedHeightMm: 300,
  };
  const corners = buildFrameCorners(sceneBounds, transformOpts);

  // Sanity: corners[0] should be (0, 50) in machine space — Y-flipped
  // top-left of the 100×50 design at canvas (10, 20).
  assert(Math.abs(corners[0].x - 0) < 0.001 && Math.abs(corners[0].y - 50) < 0.001,
    `front-origin sanity: corners[0] = (0, 50), got (${corners[0].x}, ${corners[0].y})`);

  const lines = buildFrameGcode(corners, {
    startMode: 'current',
    laserMode: 'off',
    maxSpindle: 1000,
  });

  // Find the first move command (after G91/G21/M5 prelude).
  const firstMoveIdx = lines.findIndex(l => /^(G0|G1)\s+X/.test(l));
  assert(firstMoveIdx >= 0, 'front-origin: at least one move emitted');
  const firstMove = parseDelta(lines[firstMoveIdx]);
  assert(firstMove !== null, 'front-origin: first move parses as G0/G1 with X/Y');
  if (firstMove) {
    assert(Math.abs(firstMove.x - 0) < 0.001 && Math.abs(firstMove.y - 50) < 0.001,
      `front-origin: first move is (0, 50) — to corners[0]; got (${firstMove.x}, ${firstMove.y})`);
  }

  // Sum of all relative deltas must be zero (frame closes back to start).
  let sumX = 0, sumY = 0;
  for (const l of lines) {
    const d = parseDelta(l);
    if (d) { sumX += d.x; sumY += d.y; }
  }
  assert(Math.abs(sumX) < 0.001 && Math.abs(sumY) < 0.001,
    `front-origin: relative deltas sum to (0, 0) — frame returns to start; got (${sumX.toFixed(3)}, ${sumY.toFixed(3)})`);

  // The frame must trace the closed rectangle (5 corner-loop deltas)
  // PLUS a final return-to-origin so the head ends back at the
  // physical starting position — without this final negated move,
  // burn-after-frame is doubly offset on front-origin machines.
  const moveCount = lines.filter(l => /^(G0|G1)\s+X/.test(l)).length;
  assert(moveCount === 6,
    `front-origin: 6 moves emitted (5 corner deltas + 1 return-to-origin); got ${moveCount}`);

  // Last move is the return-to-origin: a G0 that negates corners[0]
  // = (0, 50). With Y-flip the negation is (0, -50).
  const lastMove = parseDelta([...lines].reverse().find(l => /^G[01]\s+X/.test(l))!);
  assert(lastMove !== null && Math.abs(lastMove.x - 0) < 0.001 && Math.abs(lastMove.y - (-50)) < 0.001,
    `front-origin: last move is the return-to-origin G0 (0, -50); got (${lastMove?.x}, ${lastMove?.y})`);
}

// ── Rear-origin (rear-left): regression check — first delta is zero, frame still works ─
{
  const sceneBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
  const transformOpts: MachineTransformOptions = {
    startMode: 'current',
    savedOrigin: null,
    originCorner: 'rear-left',
    bedHeightMm: 300,
  };
  const corners = buildFrameCorners(sceneBounds, transformOpts);

  // Rear-origin: corners[0] should be (0, 0) in machine space.
  assert(Math.abs(corners[0].x - 0) < 0.001 && Math.abs(corners[0].y - 0) < 0.001,
    `rear-origin sanity: corners[0] = (0, 0), got (${corners[0].x}, ${corners[0].y})`);

  const lines = buildFrameGcode(corners, {
    startMode: 'current',
    laserMode: 'off',
    maxSpindle: 1000,
  });

  const moves = lines.filter(l => /^(G0|G1)\s+X/.test(l));
  // First delta corners[0] - (0,0) is (0,0) — skipped by eps.
  // Expect 4 moves traversing the rectangle.
  assert(moves.length === 4,
    `rear-origin: 4 moves emitted (zero-length first delta skipped by eps); got ${moves.length}`);

  // Frame still closes — relative deltas sum to (0, 0).
  let sumX = 0, sumY = 0;
  for (const l of moves) {
    const d = parseDelta(l);
    if (d) { sumX += d.x; sumY += d.y; }
  }
  assert(Math.abs(sumX) < 0.001 && Math.abs(sumY) < 0.001,
    `rear-origin: deltas sum to (0, 0); got (${sumX.toFixed(3)}, ${sumY.toFixed(3)})`);
}

// ── Front-origin laser-dot mode: first move must also fire (G1, not G0) ──
{
  const sceneBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
  const transformOpts: MachineTransformOptions = {
    startMode: 'current',
    savedOrigin: null,
    originCorner: 'front-left',
    bedHeightMm: 300,
  };
  const corners = buildFrameCorners(sceneBounds, transformOpts);

  const lines = buildFrameGcode(corners, {
    startMode: 'current',
    laserMode: 'dot',
    maxSpindle: 1000,
  });

  const firstMoveIdx = lines.findIndex(l => /^G[01]\s+X/.test(l));
  const firstMove = parseDelta(lines[firstMoveIdx]);
  assert(firstMove?.cmd === 'G1',
    'front-origin dot mode: first move is G1 (laser-on motion), not G0');
  if (firstMove) {
    assert(Math.abs(firstMove.x - 0) < 0.001 && Math.abs(firstMove.y - 50) < 0.001,
      'front-origin dot mode: first move is still (0, 50) — to corners[0]');
  }
}

// ── Saved-origin mode: corners[0] is at (0, 0) since saved origin is the design anchor ──
{
  const sceneBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
  const transformOpts: MachineTransformOptions = {
    startMode: 'savedOrigin',
    savedOrigin: { x: 0, y: 0 },
    originCorner: 'front-left',
    bedHeightMm: 300,
  };
  const corners = buildFrameCorners(sceneBounds, transformOpts);
  const lines = buildFrameGcode(corners, {
    startMode: 'current',
    laserMode: 'off',
    maxSpindle: 1000,
  });
  // We're using current-mode g-code with corners that came from
  // savedOrigin transform — the frame must still close (deltas sum to 0).
  let sumX = 0, sumY = 0;
  for (const l of lines) {
    const d = parseDelta(l);
    if (d) { sumX += d.x; sumY += d.y; }
  }
  assert(Math.abs(sumX) < 0.001 && Math.abs(sumY) < 0.001,
    'savedOrigin corners + current frame: deltas still sum to (0, 0)');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
