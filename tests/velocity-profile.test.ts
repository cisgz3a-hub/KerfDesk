/**
 * Velocity profile for acceleration-aware raster power.
 * Run: npx tsx tests/velocity-profile.test.ts
 */

import {
  computeVelocityZones,
  velocityAt,
  scalePowerByVelocity,
  type MoveKinematics,
} from '../src/core/plan/VelocityProfile';

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

console.log('\n=== VelocityProfile ===\n');

const trapK: MoveKinematics = {
  distanceMm: 100,
  feedrateMmPerMin: 6000,
  entryVelocityMmPerMin: 0,
  exitVelocityMmPerMin: 0,
  maxAccelMmPerS2: 1000,
};

{
  const z = computeVelocityZones(trapK);
  assert(z.isTriangular === false, 'long move is trapezoidal');
  assert(Math.abs(z.accelEndMm - 5) < 0.05, `accelEnd ≈ 5 (got ${z.accelEndMm})`);
  assert(Math.abs(z.decelStartMm - 95) < 0.05, `decelStart ≈ 95 (got ${z.decelStartMm})`);
  assert(Math.abs(z.peakVelocityMmPerMin - 6000) < 1, 'peak ≈ feed');
}

{
  const shortK: MoveKinematics = { ...trapK, distanceMm: 2 };
  const z = computeVelocityZones(shortK);
  assert(z.isTriangular === true, 'short move triangular');
  assert(z.peakVelocityMmPerMin < 6000, 'peak below feed');
  assert(z.peakVelocityMmPerMin > 0, 'peak positive');
  assert(Math.abs(z.accelEndMm - z.decelStartMm) < 0.05, 'accel end ≈ decel start');
  assert(Math.abs(z.accelEndMm - 1) < 0.05, 'apex near 1mm');
}

{
  const z = computeVelocityZones(trapK);
  assert(Math.abs(velocityAt(0, trapK, z)) < 0.1, 'v(0)≈0');
}

{
  const z = computeVelocityZones(trapK);
  assert(Math.abs(velocityAt(50, trapK, z) - 6000) < 2, 'cruise at 6000');
}

{
  const z = computeVelocityZones(trapK);
  assert(Math.abs(velocityAt(100, trapK, z)) < 0.1, 'v(end)≈0');
}

{
  const z = computeVelocityZones(trapK);
  assert(Math.abs(velocityAt(2.5, trapK, z) - 4243) < 2, 'v(2.5mm)≈4243');
}

{
  const k: MoveKinematics = {
    distanceMm: 100,
    feedrateMmPerMin: 6000,
    entryVelocityMmPerMin: 3000,
    exitVelocityMmPerMin: 3000,
    maxAccelMmPerS2: 1000,
  };
  const z = computeVelocityZones(k);
  assert(Math.abs(z.accelEndMm - 3.75) < 0.05, 'accel with entry 3000');
  assert(Math.abs(z.decelStartMm - 96.25) < 0.05, 'decel start');
  assert(Math.abs(velocityAt(0, k, z) - 3000) < 2, 'entry vel');
  assert(Math.abs(velocityAt(100, k, z) - 3000) < 2, 'exit vel');
}

{
  assert(scalePowerByVelocity(1000, 6000, 6000, 0.1) === 1000, 'full power at speed');
  assert(scalePowerByVelocity(1000, 0, 6000, 0.1) === 100, 'floor 10%');
  assert(scalePowerByVelocity(1000, 3000, 6000, 0.1) === 500, 'half speed half power');
}

{
  assert(scalePowerByVelocity(1000, 9000, 6000, 0.1) === 1000, 'clamp overspeed');
}

{
  assert(scalePowerByVelocity(1000, 0, 6000, 0.0) === 0, 'floor 0 allows zero');
  assert(scalePowerByVelocity(1000, 0, 6000, 0.2) === 200, 'floor 20%');
}

{
  const zeroK: MoveKinematics = {
    distanceMm: 0,
    feedrateMmPerMin: 1000,
    entryVelocityMmPerMin: 0,
    exitVelocityMmPerMin: 0,
    maxAccelMmPerS2: 1000,
  };
  let threw = false;
  try {
    computeVelocityZones(zeroK);
  } catch {
    threw = true;
  }
  assert(!threw, 'zero distance does not throw');
}

{
  const zeroF: MoveKinematics = {
    distanceMm: 10,
    feedrateMmPerMin: 0,
    entryVelocityMmPerMin: 0,
    exitVelocityMmPerMin: 0,
    maxAccelMmPerS2: 1000,
  };
  let threw = false;
  try {
    computeVelocityZones(zeroF);
  } catch {
    threw = true;
  }
  assert(!threw, 'zero feedrate clamps, no throw');
}

console.log(`\n=== Summary ===\nPassed: ${passed}, Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
