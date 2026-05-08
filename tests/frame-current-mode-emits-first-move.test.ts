/**
 * Current/head frame mode uses local workpiece coordinates. Front-origin bed
 * mirroring is intentionally not applied here; the user has already jogged the
 * laser to the physical anchor.
 *
 * Run: npx tsx tests/frame-current-mode-emits-first-move.test.ts
 */
import { buildFrameCorners, buildFrameGcode } from '../src/app/frameGcode';
import type { MachineTransformOptions } from '../src/core/plan/MachineTransform';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

interface ParsedDelta {
  cmd: 'G0' | 'G1';
  x: number;
  y: number;
}

function parseDelta(line: string): ParsedDelta | null {
  const match = /^(G0|G1)\s+X(-?\d+(?:\.\d+)?)\s+Y(-?\d+(?:\.\d+)?)/.exec(line);
  if (!match) return null;
  return { cmd: match[1] as 'G0' | 'G1', x: parseFloat(match[2]), y: parseFloat(match[3]) };
}

function sumDeltas(lines: readonly string[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const line of lines) {
    const delta = parseDelta(line);
    if (delta) {
      x += delta.x;
      y += delta.y;
    }
  }
  return { x, y };
}

console.log('\n=== frame current-mode local orientation ===\n');

{
  const sceneBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
  const transformOpts: MachineTransformOptions = {
    startMode: 'current',
    savedOrigin: null,
    originCorner: 'front-left',
    bedHeightMm: 300,
  };
  const corners = buildFrameCorners(sceneBounds, transformOpts);

  assert(
    Math.abs(corners[0].x - 0) < 0.001 && Math.abs(corners[0].y - 0) < 0.001,
    `front-origin current: corners[0] is local origin, got (${corners[0].x}, ${corners[0].y})`,
  );
  assert(
    Math.abs(corners[2].x - 100) < 0.001 && Math.abs(corners[2].y - 50) < 0.001,
    `front-origin current: lower-right stays at (100, 50), got (${corners[2].x}, ${corners[2].y})`,
  );

  const lines = buildFrameGcode(corners, {
    startMode: 'current',
    laserMode: 'off',
    maxSpindle: 1000,
  });

  const moves = lines.filter(line => /^(G0|G1)\s+X/.test(line));
  assert(moves.length === 4, `front-origin current: 4 frame moves emitted; got ${moves.length}`);

  const firstMove = parseDelta(moves[0]);
  assert(firstMove !== null, 'front-origin current: first move parses');
  if (firstMove) {
    assert(
      Math.abs(firstMove.x - 100) < 0.001 && Math.abs(firstMove.y - 0) < 0.001,
      `front-origin current: first move traces top edge, got (${firstMove.x}, ${firstMove.y})`,
    );
  }

  const summed = sumDeltas(moves);
  assert(
    Math.abs(summed.x) < 0.001 && Math.abs(summed.y) < 0.001,
    `front-origin current: frame closes back to start; got (${summed.x.toFixed(3)}, ${summed.y.toFixed(3)})`,
  );
}

{
  const sceneBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
  const transformOpts: MachineTransformOptions = {
    startMode: 'current',
    savedOrigin: null,
    originCorner: 'rear-left',
    bedHeightMm: 300,
  };
  const corners = buildFrameCorners(sceneBounds, transformOpts);
  const lines = buildFrameGcode(corners, {
    startMode: 'current',
    laserMode: 'off',
    maxSpindle: 1000,
  });

  const moves = lines.filter(line => /^(G0|G1)\s+X/.test(line));
  assert(moves.length === 4, `rear-origin current: 4 frame moves emitted; got ${moves.length}`);
  const summed = sumDeltas(moves);
  assert(
    Math.abs(summed.x) < 0.001 && Math.abs(summed.y) < 0.001,
    `rear-origin current: frame closes back to start; got (${summed.x.toFixed(3)}, ${summed.y.toFixed(3)})`,
  );
}

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

  const firstMove = parseDelta(lines.find(line => /^G[01]\s+X/.test(line)) ?? '');
  assert(firstMove?.cmd === 'G1', 'front-origin dot mode: first move is G1');
  if (firstMove) {
    assert(
      Math.abs(firstMove.x - 100) < 0.001 && Math.abs(firstMove.y - 0) < 0.001,
      `front-origin dot mode: first move traces top edge, got (${firstMove.x}, ${firstMove.y})`,
    );
  }
}

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
  const summed = sumDeltas(lines);
  assert(
    Math.abs(summed.x) < 0.001 && Math.abs(summed.y) < 0.001,
    `savedOrigin frame corners close back to start; got (${summed.x.toFixed(3)}, ${summed.y.toFixed(3)})`,
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
