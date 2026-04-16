/**
 * Smart overscan kinematics.
 * Run: node node_modules/tsx/dist/cli.mjs tests/smart-overscan.test.ts
 */

import { computeSmartOverscan } from '../src/core/plan/SmartOverscan';

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

function assertClose(actual: number, expected: number, tol: number, message: string): void {
  assert(Math.abs(actual - expected) < tol, `${message} (got ${actual}, ~${expected})`);
}

console.log('\n=== SmartOverscan ===\n');

{
  const result = computeSmartOverscan({
    scanSpeedMmPerMin: 6000,
    maxAccelMmPerS2: 1000,
    accelAwarePowerEnabled: false,
  });
  assertClose(result.theoreticalMinMm, 5, 0.05, 'theoretical 6000/1000');
  assertClose(result.overscanMm, 5.5, 0.05, 'overscan with 1.1 safety');
  assert(result.clampedByMinimum === false, 'not clamped');
}

{
  const result = computeSmartOverscan({
    scanSpeedMmPerMin: 1000,
    maxAccelMmPerS2: 2000,
    accelAwarePowerEnabled: false,
  });
  assertClose(result.overscanMm, 0.5, 0.05, 'low speed clamps to min');
  assert(result.clampedByMinimum === true, 'clamped low speed');
}

{
  const input = {
    scanSpeedMmPerMin: 12000,
    maxAccelMmPerS2: 1000,
    accelAwarePowerEnabled: true,
  };
  const withAccelAware = computeSmartOverscan(input);
  const withoutAccelAware = computeSmartOverscan({ ...input, accelAwarePowerEnabled: false });
  assert(withAccelAware.overscanMm < withoutAccelAware.overscanMm, 'accel-aware smaller');
  assert(
    withAccelAware.overscanMm >= withAccelAware.theoreticalMinMm * 1.0 - 1e-6,
    'accel-aware >= theoretical',
  );
}

{
  const slow = computeSmartOverscan({
    scanSpeedMmPerMin: 3000,
    maxAccelMmPerS2: 1000,
    accelAwarePowerEnabled: false,
  });
  const fast = computeSmartOverscan({
    scanSpeedMmPerMin: 6000,
    maxAccelMmPerS2: 1000,
    accelAwarePowerEnabled: false,
  });
  assertClose(fast.theoreticalMinMm, slow.theoreticalMinMm * 4, 0.05, 'quadratic speed');
}

{
  const lowAccel = computeSmartOverscan({
    scanSpeedMmPerMin: 6000,
    maxAccelMmPerS2: 500,
    accelAwarePowerEnabled: false,
  });
  const highAccel = computeSmartOverscan({
    scanSpeedMmPerMin: 6000,
    maxAccelMmPerS2: 2000,
    accelAwarePowerEnabled: false,
  });
  assertClose(highAccel.theoreticalMinMm, lowAccel.theoreticalMinMm / 4, 0.05, 'inverse accel');
}

{
  const result = computeSmartOverscan({
    scanSpeedMmPerMin: 1000,
    maxAccelMmPerS2: 2000,
    accelAwarePowerEnabled: false,
    minimumMm: 2.0,
  });
  assert(result.overscanMm === 2.0, 'custom minimum');
  assert(result.clampedByMinimum === true, 'clamped custom min');
}

{
  const result = computeSmartOverscan({
    scanSpeedMmPerMin: 6000,
    maxAccelMmPerS2: 1000,
    accelAwarePowerEnabled: false,
    safetyFactor: 1.5,
  });
  assertClose(result.overscanMm, 7.5, 0.05, 'custom safety 1.5');
}

{
  const result = computeSmartOverscan({
    scanSpeedMmPerMin: 0,
    maxAccelMmPerS2: 1000,
    accelAwarePowerEnabled: false,
  });
  assert(result.theoreticalMinMm === 0, 'zero speed theoretical 0');
  assert(result.overscanMm === 0.5, 'zero speed min floor');
}

{
  const result = computeSmartOverscan({
    scanSpeedMmPerMin: 6000,
    maxAccelMmPerS2: 0,
    accelAwarePowerEnabled: false,
  });
  assert(Number.isFinite(result.overscanMm), 'zero accel finite');
  assert(result.overscanMm > 0, 'zero accel positive overscan');
}

console.log(`\n=== Summary ===\nPassed: ${passed}, Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
