/**
 * T1-154: regression test for the pure number-validation + mode-
 * mapping helpers extracted from JobCompiler.
 *
 * Run: npx tsx tests/job-compiler-helpers.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RASTER_MAX_ACCEL_MM_PER_S2,
  MAX_PLAUSIBLE_ACCEL_MM_PER_S2,
  MIN_PLAUSIBLE_ACCEL_MM_PER_S2,
  clampFiniteNumber,
  isPlausibleMachineAccel,
  mapModeToType,
} from '../src/core/job/jobCompilerHelpers';

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

console.log('\n=== T1-154 JobCompiler helpers ===\n');

// -------- Acceleration bounds (canonical values) --------
assert(MIN_PLAUSIBLE_ACCEL_MM_PER_S2 === 100, 'MIN bound = 100 mm/s²');
assert(MAX_PLAUSIBLE_ACCEL_MM_PER_S2 === 20000, 'MAX bound = 20000 mm/s²');
assert(DEFAULT_RASTER_MAX_ACCEL_MM_PER_S2 === 1000, 'DEFAULT = 1000 mm/s²');

// -------- isPlausibleMachineAccel --------
assert(isPlausibleMachineAccel(1000), 'mid-range value → plausible');
assert(isPlausibleMachineAccel(100), 'value at MIN boundary → plausible');
assert(isPlausibleMachineAccel(20000), 'value at MAX boundary → plausible');
assert(!isPlausibleMachineAccel(99), 'value below MIN → not plausible');
assert(!isPlausibleMachineAccel(20001), 'value above MAX → not plausible');
assert(!isPlausibleMachineAccel(null), 'null → not plausible');
assert(!isPlausibleMachineAccel(undefined), 'undefined → not plausible');
assert(!isPlausibleMachineAccel(NaN), 'NaN → not plausible');
assert(!isPlausibleMachineAccel(Infinity), 'Infinity → not plausible');
assert(!isPlausibleMachineAccel(-1000), 'negative → not plausible');
assert(!isPlausibleMachineAccel(0), '0 → not plausible (below MIN)');

// -------- clampFiniteNumber --------
assert(clampFiniteNumber(5, 0, 10, -1) === 5, 'in-range → unchanged');
assert(clampFiniteNumber(-5, 0, 10, -1) === 0, 'below min → clamped to min');
assert(clampFiniteNumber(15, 0, 10, -1) === 10, 'above max → clamped to max');
assert(clampFiniteNumber(NaN, 0, 10, 7) === 7, 'NaN → fallback');
assert(clampFiniteNumber(Infinity, 0, 10, 7) === 7, 'Infinity → fallback');
assert(clampFiniteNumber(undefined, 0, 10, 7) === 7, 'undefined → fallback');
// Number(null) === 0, which IS finite, so it gets clamped (0 is in
// range, returned as-is) — not the fallback path.
assert(clampFiniteNumber(null, 0, 10, 7) === 0, 'null → Number(null)=0, in range, returns 0 (NOT fallback)');
// Number(null) === 0, which IS finite, so clamps to range — verify behavior
assert(clampFiniteNumber('5', 0, 10, -1) === 5, 'string "5" coerced to 5');
assert(clampFiniteNumber('abc', 0, 10, -1) === -1, 'unparseable string → fallback');
assert(clampFiniteNumber(0.5, 0, 10, -1) === 0.5, 'fractional in-range preserved');

// -------- mapModeToType --------
assert(mapModeToType('cut') === 'cut', 'cut → cut');
assert(mapModeToType('engrave') === 'engrave', 'engrave → engrave');
assert(mapModeToType('score') === 'score', 'score → score');
assert(mapModeToType('image') === 'raster', 'image → raster (operator-language vs planner-language)');

// -------- Source-level pin: JobCompiler delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const jcSrc = readFileSync(
    resolve(here, '../src/core/job/JobCompiler.ts'),
    'utf-8',
  );
  assert(/from '\.\/jobCompilerHelpers'/.test(jcSrc),
    'JobCompiler imports from ./jobCompilerHelpers');
  assert(/T1-154/.test(jcSrc),
    'JobCompiler carries T1-154 marker');
  // Inline definitions gone
  assert(!/^function isPlausibleMachineAccel/m.test(jcSrc),
    'inline isPlausibleMachineAccel is gone');
  assert(!/^function clampFiniteNumber/m.test(jcSrc),
    'inline clampFiniteNumber is gone');
  assert(!/^function mapModeToType/m.test(jcSrc),
    'inline mapModeToType is gone');
  assert(!/^const MIN_PLAUSIBLE_ACCEL_MM_PER_S2 = 100/m.test(jcSrc),
    'inline MIN bound declaration is gone');
  assert(!/^const DEFAULT_RASTER_MAX_ACCEL_MM_PER_S2 = 1000/m.test(jcSrc),
    'inline DEFAULT acceleration declaration is gone');

  const helperSrc = readFileSync(
    resolve(here, '../src/core/job/jobCompilerHelpers.ts'),
    'utf-8',
  );
  assert(/T1-154/.test(helperSrc),
    'jobCompilerHelpers carries T1-154 marker');
  for (const name of [
    'isPlausibleMachineAccel',
    'clampFiniteNumber',
    'mapModeToType',
  ]) {
    const re = new RegExp(`export function ${name}`);
    assert(re.test(helperSrc), `${name} is exported`);
  }
  for (const name of [
    'MIN_PLAUSIBLE_ACCEL_MM_PER_S2',
    'MAX_PLAUSIBLE_ACCEL_MM_PER_S2',
    'DEFAULT_RASTER_MAX_ACCEL_MM_PER_S2',
  ]) {
    const re = new RegExp(`export const ${name}`);
    assert(re.test(helperSrc), `${name} is exported`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
