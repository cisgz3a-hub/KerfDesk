/**
 * T1-178 (external audit High #4): controller-operation arguments
 * must be validated at the boundary before composing the G-code line.
 *
 * Pre-T1-178 evidence:
 *
 *   // jog (GrblController.ts:179-180)
 *   `$J=G91 G21 ${args.axis}${args.distanceMm} F${args.feedMmPerMin}`
 *   // No bounds, no finiteness check, no axis enum check.
 *
 *   // testFire (GrblController.ts:189-192)
 *   const sVal = Math.max(0, Math.round((args.powerPercent / 100) * args.maxSpindle));
 *   // Lower bound clamped, upper NOT clamped. powerPercent=500
 *   // with maxSpindle=1000 emits `M3 S5000`.
 *
 *   // frame (GrblController.ts:193-226)
 *   // corners + maxSpindle + frameDotFeedRateMmPerMin pass straight
 *   // into buildGrblFrameGcode.
 *
 * Post-T1-178: each operation validates at the controller boundary
 * via `validateJogArgs` / `validateTestFireArgs` / `validateFrameArgs`.
 * Invalid input throws `InvalidOperationArgumentError` carrying
 * `field` + `value` — the operation's async return rejects the
 * promise without composing any G-code.
 *
 * Run: npx tsx tests/grbl-operation-validators-reject-bad-numbers.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InvalidOperationArgumentError,
  validateJogArgs,
  validateTestFireArgs,
  validateFrameArgs,
  MAX_JOG_DISTANCE_MM,
  MAX_FEED_MM_PER_MIN,
  MAX_SPINDLE_VALUE,
} from '../src/controllers/grbl/grblOperationValidators';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function expectThrows<T>(fn: () => T, fieldHint: string, message: string): void {
  let threwCorrectly = false;
  let actualErr: unknown = null;
  try {
    fn();
  } catch (e) {
    actualErr = e;
    if (e instanceof InvalidOperationArgumentError && e.field === fieldHint) {
      threwCorrectly = true;
    }
  }
  if (threwCorrectly) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}  (actual error: ${actualErr})`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));

console.log('\n=== T1-178 GRBL operation validators reject bad numbers (audit High #4) ===\n');

// -------- 1. Bounds constants are exported with sane values --------
{
  assert(MAX_JOG_DISTANCE_MM === 10000, `MAX_JOG_DISTANCE_MM === 10000 (got ${MAX_JOG_DISTANCE_MM})`);
  assert(MAX_FEED_MM_PER_MIN === 100000, `MAX_FEED_MM_PER_MIN === 100000 (got ${MAX_FEED_MM_PER_MIN})`);
  assert(MAX_SPINDLE_VALUE === 100000, `MAX_SPINDLE_VALUE === 100000 (got ${MAX_SPINDLE_VALUE})`);
}

// -------- 2. validateJogArgs: happy paths --------
{
  let threw = false;
  try {
    validateJogArgs({ axis: 'X', distanceMm: 10, feedMmPerMin: 3000 });
    validateJogArgs({ axis: 'Y', distanceMm: -50, feedMmPerMin: 6000 }); // backward jog OK
    validateJogArgs({ axis: 'Z', distanceMm: 0, feedMmPerMin: 100 });    // zero distance OK
  } catch { threw = true; }
  assert(!threw, 'happy paths: legal X/Y/Z jogs do not throw');
}

// -------- 3. validateJogArgs: invalid axis --------
expectThrows(
  () => validateJogArgs({ axis: 'A' as 'X', distanceMm: 10, feedMmPerMin: 3000 }),
  'axis',
  'axis must be one of X/Y/Z (rejects "A")',
);

// -------- 4. validateJogArgs: distance bounds --------
expectThrows(
  () => validateJogArgs({ axis: 'X', distanceMm: Number.NaN, feedMmPerMin: 3000 }),
  'distanceMm',
  'distance rejects NaN',
);
expectThrows(
  () => validateJogArgs({ axis: 'X', distanceMm: Number.POSITIVE_INFINITY, feedMmPerMin: 3000 }),
  'distanceMm',
  'distance rejects Infinity',
);
expectThrows(
  () => validateJogArgs({ axis: 'X', distanceMm: 99999, feedMmPerMin: 3000 }),
  'distanceMm',
  `distance rejects > MAX_JOG_DISTANCE_MM (${MAX_JOG_DISTANCE_MM})`,
);
expectThrows(
  () => validateJogArgs({ axis: 'X', distanceMm: -99999, feedMmPerMin: 3000 }),
  'distanceMm',
  'distance rejects very-negative (absolute-value bound)',
);

// -------- 5. validateJogArgs: feed bounds --------
expectThrows(
  () => validateJogArgs({ axis: 'X', distanceMm: 10, feedMmPerMin: 0 }),
  'feedMmPerMin',
  'feed rejects 0 (must be strictly positive)',
);
expectThrows(
  () => validateJogArgs({ axis: 'X', distanceMm: 10, feedMmPerMin: -100 }),
  'feedMmPerMin',
  'feed rejects negative',
);
expectThrows(
  () => validateJogArgs({ axis: 'X', distanceMm: 10, feedMmPerMin: Number.NaN }),
  'feedMmPerMin',
  'feed rejects NaN',
);
expectThrows(
  () => validateJogArgs({ axis: 'X', distanceMm: 10, feedMmPerMin: 999999 }),
  'feedMmPerMin',
  `feed rejects > MAX_FEED_MM_PER_MIN (${MAX_FEED_MM_PER_MIN})`,
);

// -------- 6. validateTestFireArgs: powerPercent + maxSpindle bounds --------
{
  let threw = false;
  try {
    validateTestFireArgs({ powerPercent: 0, maxSpindle: 1000 });   // legal: 0 power = laser off
    validateTestFireArgs({ powerPercent: 100, maxSpindle: 1000 }); // legal: max power
    validateTestFireArgs({ powerPercent: 50, maxSpindle: 255 });   // legal: small spindle
  } catch { threw = true; }
  assert(!threw, 'testFire happy paths do not throw');
}
expectThrows(
  () => validateTestFireArgs({ powerPercent: 500, maxSpindle: 1000 }),
  'powerPercent',
  'powerPercent rejects 500 (the audit\'s exact bug — pre-T1-178 this emitted M3 S5000)',
);
expectThrows(
  () => validateTestFireArgs({ powerPercent: -10, maxSpindle: 1000 }),
  'powerPercent',
  'powerPercent rejects negative',
);
expectThrows(
  () => validateTestFireArgs({ powerPercent: Number.NaN, maxSpindle: 1000 }),
  'powerPercent',
  'powerPercent rejects NaN',
);
expectThrows(
  () => validateTestFireArgs({ powerPercent: 50, maxSpindle: 0 }),
  'maxSpindle',
  'maxSpindle rejects 0',
);
expectThrows(
  () => validateTestFireArgs({ powerPercent: 50, maxSpindle: -1000 }),
  'maxSpindle',
  'maxSpindle rejects negative',
);

// -------- 7. validateFrameArgs: corners + maxSpindle + feed --------
{
  let threw = false;
  try {
    validateFrameArgs({
      corners: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      maxSpindle: 1000,
      frameDotFeedRateMmPerMin: 3000,
    });
    validateFrameArgs({
      corners: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      maxSpindle: 1000,
    });
  } catch { threw = true; }
  assert(!threw, 'frame happy paths do not throw');
}
expectThrows(
  () => validateFrameArgs({ corners: [], maxSpindle: 1000 }),
  'corners',
  'corners rejects empty array',
);
expectThrows(
  () => validateFrameArgs({
    corners: [{ x: Number.NaN, y: 0 }],
    maxSpindle: 1000,
  }),
  'corners[0].x',
  'corners rejects NaN x',
);
expectThrows(
  () => validateFrameArgs({
    corners: [{ x: 0, y: Number.POSITIVE_INFINITY }],
    maxSpindle: 1000,
  }),
  'corners[0].y',
  'corners rejects Infinity y',
);
expectThrows(
  () => validateFrameArgs({
    corners: [{ x: 0, y: 0 }],
    maxSpindle: Number.NaN,
  }),
  'maxSpindle',
  'frame maxSpindle rejects NaN',
);
expectThrows(
  () => validateFrameArgs({
    corners: [{ x: 0, y: 0 }],
    maxSpindle: 1000,
    frameDotFeedRateMmPerMin: 0,
  }),
  'frameDotFeedRateMmPerMin',
  'frame feed rejects 0',
);
expectThrows(
  () => validateFrameArgs({
    corners: [{ x: 0, y: 0 }],
    maxSpindle: 1000,
    frameDotFeedRateMmPerMin: -100,
  }),
  'frameDotFeedRateMmPerMin',
  'frame feed rejects negative',
);

// -------- 8. InvalidOperationArgumentError carries field + value --------
{
  try {
    validateJogArgs({ axis: 'X', distanceMm: Number.NaN, feedMmPerMin: 3000 });
    assert(false, 'expected throw');
  } catch (e) {
    if (e instanceof InvalidOperationArgumentError) {
      assert(e.field === 'distanceMm', `error.field === 'distanceMm' (got '${e.field}')`);
      assert(Number.isNaN(e.value), 'error.value === NaN');
      assert(e.name === 'InvalidOperationArgumentError', 'error.name set');
      assert(/finite number/i.test(e.message), 'error.message describes the failure mode');
    }
  }
}

// -------- 9. Source pins on controller wiring --------
{
  const src = readFileSync(resolve(here, '../src/controllers/grbl/GrblController.ts'), 'utf-8');
  assert(/T1-178/.test(src), 'GrblController carries T1-178 marker');
  assert(/audit High #4/.test(src), 'GrblController cross-references audit High #4');
  assert(
    /validateJogArgs\(args\)/.test(src),
    'jog operation calls validateJogArgs(args)',
  );
  assert(
    /validateTestFireArgs\(args\)/.test(src),
    'testFire operation calls validateTestFireArgs(args)',
  );
  assert(
    /validateFrameArgs\(/.test(src),
    'frame operation calls validateFrameArgs(...)',
  );
  // The validator module is re-exported from GrblController for
  // backwards-compat with callers that import the error class.
  assert(
    /export\s*\{[\s\S]*?InvalidOperationArgumentError[\s\S]*?\}\s+from\s+['"]\.\/grblOperationValidators['"]/.test(src),
    'GrblController re-exports InvalidOperationArgumentError',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
