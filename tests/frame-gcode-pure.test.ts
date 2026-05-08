/**
 * Golden tests for frame gcode construction (T2-4 phase 4).
 * Run: npx tsx tests/frame-gcode-pure.test.ts
 */
import { buildFrameCorners, buildFrameGcode } from '../src/app/frameGcode';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function assertEq(a: unknown, b: unknown, msg: string): void {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) {
    console.error('expected', b);
    console.error('actual', a);
  }
  assert(ok, msg);
}

const sceneBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
const transformCurrent = {
  startMode: 'current' as const,
  savedOrigin: null,
  originCorner: 'front-left' as const,
  bedHeightMm: 300,
};
const transformAbsolute = {
  startMode: 'absolute' as const,
  savedOrigin: null,
  originCorner: 'front-left' as const,
  bedHeightMm: 300,
};

console.log('\n=== frame-gcode pure (golden) ===\n');

{
  const corners = buildFrameCorners(sceneBounds, transformCurrent);
  assertEq(
    corners,
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: -100 },
      { x: 0, y: -100 },
      { x: 0, y: 0 },
    ],
    'buildFrameCorners current/head follows front-origin axis signs',
  );

  const safe = buildFrameGcode(corners, {
    startMode: 'current',
    laserMode: 'off',
    maxSpindle: 1000,
  });
  assertEq(
    safe,
    [
      'G91',
      'G21',
      'M5 S0',
      'G0 X100.000 Y0.000',
      'G0 X0.000 Y-100.000',
      'G0 X-100.000 Y0.000',
      'G0 X0.000 Y100.000',
      'M5 S0',
      'G90',
    ],
    'frame safe current mode - front-origin axis signs',
  );

  const dot = buildFrameGcode(corners, {
    startMode: 'current',
    laserMode: 'dot',
    maxSpindle: 1000,
  });
  assertEq(
    dot,
    [
      'G91',
      'G21',
      'M4 S5',
      'G1 X100.000 Y0.000 F3000',
      'G1 X0.000 Y-100.000 F3000',
      'G1 X-100.000 Y0.000 F3000',
      'G1 X0.000 Y100.000 F3000',
      'M5 S0',
      'G90',
    ],
    'frame dot current mode - front-origin axis signs',
  );
}

{
  const corners = buildFrameCorners(sceneBounds, transformAbsolute);
  assertEq(
    corners,
    [
      { x: 0, y: 300 },
      { x: 100, y: 300 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
      { x: 0, y: 300 },
    ],
    'buildFrameCorners absolute + front-left',
  );

  const safeAbs = buildFrameGcode(corners, {
    startMode: 'absolute',
    laserMode: 'off',
    maxSpindle: 1000,
  });
  assertEq(
    safeAbs,
    [
      'G90',
      'G21',
      'M5 S0',
      'G0 X0.000 Y300.000',
      'G0 X100.000 Y300.000',
      'G0 X100.000 Y200.000',
      'G0 X0.000 Y200.000',
      'G0 X0.000 Y300.000',
      'M5 S0',
    ],
    'frame safe absolute mode — machine-space G0 loop',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
