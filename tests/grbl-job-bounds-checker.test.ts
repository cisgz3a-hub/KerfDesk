/**
 * T1-139: regression test for the pure GRBL job-bounds checker
 * extracted from `GrblController._checkJobBounds`. The checker is the
 * controller-layer defense-in-depth for out-of-bed motion — even if
 * compile-time preflight is bypassed, this scans every G0/G1 X/Y move
 * and refuses the job if any would drive past the bed.
 *
 * Pre-T1-139 the rules lived inside a private method using
 * `this._bedWidth` / `this._state.position` / `this._positionConfirmed`
 * directly; testing the G91 + position-confirmed gate required
 * mounting the whole controller. Post-T1-139 every branch is testable
 * with synthetic inputs.
 *
 * Run: npx tsx tests/grbl-job-bounds-checker.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkGrblJobBounds,
  checkGrblJobBoundsChunk,
  createGrblJobBoundsState,
  type GrblJobBoundsContext,
} from '../src/controllers/grbl/GrblJobBoundsChecker';

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

function ctx(overrides: Partial<GrblJobBoundsContext> = {}): GrblJobBoundsContext {
  return {
    bedWidthMm: 400,
    bedHeightMm: 300,
    headPosition: { x: 0, y: 0 },
    positionConfirmed: true,
    ...overrides,
  };
}

console.log('\n=== T1-139 GRBL job-bounds checker ===\n');

// -------- 1. empty job → null --------
{
  assert(checkGrblJobBounds([], ctx()) === null,
    'empty job → no error');
}

// -------- 2. non-positive bed → bounds checking skipped --------
{
  // A wildly out-of-bounds move would normally trigger; with bedW=0 it doesn't.
  const r = checkGrblJobBounds(['G0 X9999 Y9999'], ctx({ bedWidthMm: 0 }));
  assert(r === null, 'bedWidthMm=0 → bounds check skipped');
  const r2 = checkGrblJobBounds(['G0 X9999 Y9999'], ctx({ bedHeightMm: -5 }));
  assert(r2 === null, 'bedHeightMm<0 → bounds check skipped');
}

// -------- 3. happy path: in-bounds absolute moves --------
{
  const r = checkGrblJobBounds(['G90', 'G0 X10 Y10', 'G1 X300 Y200'], ctx());
  assert(r === null, 'in-bounds absolute moves → null');
}

// -------- 4. X over bed width --------
{
  const r = checkGrblJobBounds(['G0 X500 Y10'], ctx());
  assert(r != null && r.includes('X=500'),
    'X past bed width → error mentions X=500');
  assert(r != null && r.includes('400mm wide'),
    'error includes bed width');
}

// -------- 5. Y over bed height --------
{
  const r = checkGrblJobBounds(['G0 X10 Y500'], ctx());
  assert(r != null && r.includes('Y=500'),
    'Y past bed height → error mentions Y=500');
}

// -------- 6. negative coords beyond EPS --------
{
  const r = checkGrblJobBounds(['G0 X-1'], ctx());
  assert(r != null && r.includes('X=-1'),
    'X=-1 (beyond -EPS) → error');
}

// -------- 7. within EPS tolerance --------
{
  // X = -0.005 is within EPS=0.01 of 0
  const r = checkGrblJobBounds(['G0 X-0.005 Y-0.005'], ctx());
  assert(r === null, 'within EPS=0.01 tolerance → null');
}

// -------- 8. EPS tolerance at far edge --------
{
  // X = 400.005 is within EPS of bedW=400
  const r = checkGrblJobBounds(['G0 X400.005 Y300.005'], ctx());
  assert(r === null, 'at bed edge + EPS → null');
}

// -------- 9. relative mode (G91): refuses if position unconfirmed --------
{
  const r = checkGrblJobBounds(
    ['G91', 'G0 X10'],
    ctx({ positionConfirmed: false }),
  );
  assert(r != null && r.includes('Cannot accept relative-mode job'),
    'G91 + unconfirmed position → "Cannot accept" error');
  assert(r != null && r.includes('Reconnect'),
    'G91 unconfirmed error includes "Reconnect" hint');
}

// -------- 10. relative mode: accumulates cursor from confirmed position --------
{
  // Start at (10, 10), move +5 in X each step. 10 + 79*5 = 405 trips
  // bounds (bedW=400, EPS=0.01 → threshold 400.01). The checker
  // returns on the FIRST tripping step, so the error mentions 405.
  const lines = ['G91', ...Array(100).fill('G0 X5')];
  const r = checkGrblJobBounds(lines, ctx({ headPosition: { x: 10, y: 10 } }));
  assert(r != null && /X=405\.000/.test(r),
    'G91 accumulates cursor → first OOB step (X=405) trips bounds');
}

// -------- 11. relative mode: returns null when accumulated stays in bounds --------
{
  // Start at (10, 10), move +5 in X 10 times → 60, still in bounds.
  const lines = ['G91', ...Array(10).fill('G0 X5')];
  const r = checkGrblJobBounds(lines, ctx({ headPosition: { x: 10, y: 10 } }));
  assert(r === null, 'G91 accumulated cursor stays in bounds → null');
}

// -------- 12. G90 after G91 restores absolute mode --------
{
  const r = checkGrblJobBounds(
    ['G91', 'G0 X100', 'G90', 'G0 X200 Y100'],
    ctx({ positionConfirmed: true, headPosition: { x: 0, y: 0 } }),
  );
  assert(r === null, 'G90 after G91 → absolute moves checked against bed directly');
}

// -------- 13. non-G0/G1 lines are skipped --------
{
  const r = checkGrblJobBounds(
    ['M3 S1000', 'M5', '; comment', 'F1000', 'G0 X100 Y100'],
    ctx(),
  );
  assert(r === null, 'M-codes, comments, F-only lines ignored');
}

// -------- 14. line without X or Y is skipped --------
{
  const r = checkGrblJobBounds(['G0 Z5'], ctx());
  assert(r === null, 'G0 with only Z and no X/Y → skipped');
}

// -------- 15. case insensitive G0/G1/X/Y --------
{
  const r = checkGrblJobBounds(['g0 x500 y10'], ctx());
  assert(r != null, 'lowercase g0/x/y still triggers the bounds check');
}

// -------- 16. fractional coords parse correctly --------
{
  const r = checkGrblJobBounds(['G0 X399.99 Y10'], ctx());
  assert(r === null, 'X=399.99 (just inside bed) → null');
  const r2 = checkGrblJobBounds(['G0 X400.5 Y10'], ctx());
  assert(r2 != null, 'X=400.5 (just outside bed + EPS) → error');
}

// -------- 17. multiple G-modal numbers (G00, G01, G021) --------
{
  // G00 is G0; should be checked. G21 is mm-mode; should be ignored.
  const r = checkGrblJobBounds(['G00 X500 Y10'], ctx());
  assert(r != null, 'G00 matches G0\\d* pattern → bounds checked');
  const r2 = checkGrblJobBounds(['G21'], ctx());
  assert(r2 === null, 'G21 unit-mode line → not a move, skipped');
}

// -------- 18. Source-level pin: GrblController delegates --------
{
  const boundsCtx = ctx({ headPosition: { x: 0, y: 0 } });
  const state = createGrblJobBoundsState(boundsCtx);
  const first = checkGrblJobBoundsChunk(['G91', 'G0 X100'], boundsCtx, state);
  const second = checkGrblJobBoundsChunk(['G0 X350'], boundsCtx, state);
  assert(first === null, 'chunk bounds checker carries safe first relative chunk');
  assert(second != null && /X=450\.000/.test(second),
    'chunk bounds checker preserves relative cursor across chunks');
}

// -------- 19. Source-level pin: GrblController delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const ctrlSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );
  assert(/from '\.\/GrblJobBoundsChecker'/.test(ctrlSrc),
    'GrblController imports from GrblJobBoundsChecker');
  assert(/checkGrblJobBounds\(lines/.test(ctrlSrc),
    'GrblController calls checkGrblJobBounds(lines, ...)');
  assert(/T1-139/.test(ctrlSrc),
    'GrblController carries T1-139 marker');
  // Inline EPS constant + relative-cursor loop are gone.
  assert(!/const EPS = 0\.01;/.test(ctrlSrc),
    'inline EPS=0.01 declaration is gone from GrblController');
  assert(!/this\._positionConfirmed/.test(ctrlSrc.replace(/\.checker?\.|JobBoundsContext/g, '')) ||
    /Cannot accept relative-mode job/.test(ctrlSrc) === false,
    'inline relative-mode "Cannot accept" message is gone from GrblController');

  const helperSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblJobBoundsChecker.ts'),
    'utf-8',
  );
  assert(/T1-139/.test(helperSrc),
    'GrblJobBoundsChecker carries T1-139 marker');
  assert(/export function checkGrblJobBounds/.test(helperSrc),
    'checkGrblJobBounds is exported');
  assert(/Cannot accept relative-mode job/.test(helperSrc),
    'relative-mode error message lives in the helper module');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
