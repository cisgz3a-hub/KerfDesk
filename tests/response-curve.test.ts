import {
  darknessToPower,
  powerToDarkness,
  type ResponseCurve,
  validateCurve,
} from '../src/core/materials/ResponseCurve';

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

function approxEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

function makeCurve(points: Array<{ commandedPower: number; observedDarkness: number }>): ResponseCurve {
  return {
    id: 'resp_test',
    materialName: 'Birch',
    calibrationSpeed: 1200,
    calibratedAt: '2026-04-22T00:00:00.000Z',
    points,
  };
}

console.log('\n=== ResponseCurve: validateCurve ===');

const validCurve = makeCurve([
  { commandedPower: 10, observedDarkness: 0.1 },
  { commandedPower: 50, observedDarkness: 0.5 },
  { commandedPower: 90, observedDarkness: 0.9 },
]);
const validResult = validateCurve(validCurve);
assert(validResult.ok === true, 'validateCurve accepts a minimal valid 3-point curve');

const nonMonotonicCurve = makeCurve([
  { commandedPower: 10, observedDarkness: 0.2 },
  { commandedPower: 50, observedDarkness: 0.6 },
  { commandedPower: 90, observedDarkness: 0.4 },
]);
const nonMonotonicResult = validateCurve(nonMonotonicCurve);
assert(nonMonotonicResult.ok === false, 'validateCurve rejects non-monotonic points');

const tooShortCurve = makeCurve([
  { commandedPower: 10, observedDarkness: 0.1 },
  { commandedPower: 90, observedDarkness: 0.8 },
]);
const tooShortResult = validateCurve(tooShortCurve);
assert(tooShortResult.ok === false, 'validateCurve rejects < 3 points');

const outOfRangeDarknessCurve = makeCurve([
  { commandedPower: 10, observedDarkness: 0.1 },
  { commandedPower: 50, observedDarkness: 1.2 },
  { commandedPower: 90, observedDarkness: 0.9 },
]);
const outOfRangeResult = validateCurve(outOfRangeDarknessCurve);
assert(outOfRangeResult.ok === false, 'validateCurve rejects darkness outside [0,1]');

console.log('\n=== ResponseCurve: darknessToPower ===');

const exactPower = darknessToPower(validCurve, 0.5);
assert(approxEqual(exactPower, 50), 'darknessToPower returns exact commandedPower at exact point');

const interpolatedPower = darknessToPower(validCurve, 0.7);
assert(approxEqual(interpolatedPower, 70), 'darknessToPower interpolates linearly between points');

const belowClampPower = darknessToPower(validCurve, -0.5);
const aboveClampPower = darknessToPower(validCurve, 2);
assert(
  approxEqual(belowClampPower, 10) && approxEqual(aboveClampPower, 90),
  'darknessToPower clamps below-range and above-range inputs',
);

console.log('\n=== ResponseCurve: round-trip ===');

const sourcePower = 63;
const dark = powerToDarkness(validCurve, sourcePower);
const roundTripPower = darknessToPower(validCurve, dark);
assert(approxEqual(roundTripPower, sourcePower, 1e-6), 'powerToDarkness is inverse via round-trip (epsilon)');

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) throw new Error(`response-curve.test.ts: ${failed} assertion(s) failed`);
process.exit(0);
