/**
 * Golden tests for the frame center-crosshair extension.
 * Run: npx tsx tests/frame-gcode-crosshair.test.ts
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

console.log('\n=== frame-gcode crosshair ===\n');

{
  const corners = buildFrameCorners(sceneBounds, transformAbsolute);
  const noCrosshair = buildFrameGcode(corners, {
    startMode: 'absolute',
    laserMode: 'dot',
    maxSpindle: 1000,
  });
  assertEq(
    noCrosshair,
    [
      'G90',
      'G21',
      'M4 S5',
      'G1 X0.000 Y300.000 F3000',
      'G1 X100.000 Y300.000 F3000',
      'G1 X100.000 Y200.000 F3000',
      'G1 X0.000 Y200.000 F3000',
      'G1 X0.000 Y300.000 F3000',
      'M5 S0',
    ],
    'absolute/dot default: rectangle only',
  );

  const explicitFalse = buildFrameGcode(corners, {
    startMode: 'absolute',
    laserMode: 'dot',
    maxSpindle: 1000,
    crosshairAfterFrame: false,
  });
  assertEq(explicitFalse, noCrosshair, 'crosshair=false matches omitted flag');
}

{
  const corners = buildFrameCorners(sceneBounds, transformAbsolute);
  const dotWithCrosshair = buildFrameGcode(corners, {
    startMode: 'absolute',
    laserMode: 'dot',
    maxSpindle: 1000,
    crosshairAfterFrame: true,
  });
  assertEq(
    dotWithCrosshair,
    [
      'G90',
      'G21',
      'M4 S5',
      'G1 X0.000 Y300.000 F3000',
      'G1 X100.000 Y300.000 F3000',
      'G1 X100.000 Y200.000 F3000',
      'G1 X0.000 Y200.000 F3000',
      'G1 X0.000 Y300.000 F3000',
      'M5 S0',
      'G0 X55.000 Y250.000',
      'M4 S5',
      'G1 X45.000 Y250.000 F3000',
      'G1 X50.000 Y250.000 F3000',
      'G1 X50.000 Y255.000 F3000',
      'G1 X50.000 Y245.000 F3000',
      'G1 X50.000 Y250.000 F3000',
      'M5 S0',
    ],
    'absolute/dot crosshair: rectangle then center mark',
  );

  const firstM5Idx = dotWithCrosshair.indexOf('M5 S0');
  assert(firstM5Idx > 0, 'absolute/dot crosshair: first M5 found');
  assert(
    dotWithCrosshair[firstM5Idx + 1]!.startsWith('G0'),
    'absolute/dot crosshair: traverse to center mark happens with laser off',
  );
  assert(dotWithCrosshair[firstM5Idx + 2] === 'M4 S5', 'absolute/dot crosshair: laser is re-enabled after traverse');
  assert(dotWithCrosshair.filter(line => line === 'M5 S0').length === 2, 'absolute/dot crosshair: rectangle and crosshair both end with M5');
  assert(dotWithCrosshair.at(-1) === 'M5 S0', 'absolute/dot crosshair: laser off at end');
}

{
  const corners = buildFrameCorners(sceneBounds, transformAbsolute);
  const offWithCrosshair = buildFrameGcode(corners, {
    startMode: 'absolute',
    laserMode: 'off',
    maxSpindle: 1000,
    crosshairAfterFrame: true,
  });
  assertEq(
    offWithCrosshair,
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
      'G0 X55.000 Y250.000',
      'G0 X45.000 Y250.000',
      'G0 X50.000 Y250.000',
      'G0 X50.000 Y255.000',
      'G0 X50.000 Y245.000',
      'G0 X50.000 Y250.000',
      'M5 S0',
    ],
    'absolute/off crosshair: motion path only',
  );
  assert(!offWithCrosshair.some(line => line.startsWith('M4')), 'absolute/off crosshair: no laser enable');
}

{
  const corners = buildFrameCorners(sceneBounds, transformCurrent);
  const dotWithCrosshairRel = buildFrameGcode(corners, {
    startMode: 'current',
    laserMode: 'dot',
    maxSpindle: 1000,
    crosshairAfterFrame: true,
  });
  assertEq(
    dotWithCrosshairRel,
    [
      'G91',
      'G21',
      'M4 S5',
      'G1 X100.000 Y0.000 F3000',
      'G1 X0.000 Y100.000 F3000',
      'G1 X-100.000 Y0.000 F3000',
      'G1 X0.000 Y-100.000 F3000',
      'M5 S0',
      'G0 X55.000 Y50.000',
      'M4 S5',
      'G1 X-10.000 Y0.000 F3000',
      'G1 X5.000 Y0.000 F3000',
      'G1 X0.000 Y5.000 F3000',
      'G1 X0.000 Y-10.000 F3000',
      'G1 X0.000 Y5.000 F3000',
      'M5 S0',
      'G0 X-50.000 Y-50.000',
      'G90',
    ],
    'current/dot crosshair: relative rectangle and center mark in local orientation',
  );
  assert(dotWithCrosshairRel[0] === 'G91', 'current/dot crosshair: starts in relative mode');
  assert(dotWithCrosshairRel.at(-1) === 'G90', 'current/dot crosshair: restores absolute mode');
}

{
  const wideBounds = { minX: 10, minY: 20, maxX: 210, maxY: 60 };
  const corners = buildFrameCorners(wideBounds, transformAbsolute);
  const dotWithCrosshair = buildFrameGcode(corners, {
    startMode: 'absolute',
    laserMode: 'dot',
    maxSpindle: 1000,
    crosshairAfterFrame: true,
  });
  assertEq(
    dotWithCrosshair.find(line => line.startsWith('G0')),
    'G0 X115.000 Y260.000',
    'wide bounds: traverse uses transformed geometric centroid plus right arm',
  );
  assert(dotWithCrosshair.includes('G1 X110.000 Y260.000 F3000'), 'wide bounds: path returns to centroid');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
