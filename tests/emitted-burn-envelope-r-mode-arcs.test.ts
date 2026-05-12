/**
 * T1-189 (extends T1-186): R-mode arc parsing in
 * `analyzeEmittedBurnEnvelope`.
 *
 * GRBL accepts `G2/G3 X.. Y.. R..` as an alternative to I/J. T1-186
 * shipped I/J only; T1-189 adds R-mode. Sign convention:
 *   - +R = shorter arc (< 180° sweep)
 *   - -R = longer arc (> 180° sweep)
 * Combined with direction:
 *   - center LEFT of chord when (R > 0) === (direction === 'G3')
 *   - center RIGHT of chord otherwise
 *
 * Run: npx tsx tests/emitted-burn-envelope-r-mode-arcs.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeEmittedBurnEnvelope } from '../src/core/output/emittedBurnEnvelope';

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

function nearlyEq(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) <= eps;
}

const here = dirname(fileURLToPath(import.meta.url));

console.log('\n=== T1-189 R-mode arc parsing in emittedBurnEnvelope ===\n');

// -------- 1. G3 +R from (10,0) → (0,10): short CCW quarter arc, center (0,0) --------
{
  const gcode = [
    'G21', 'G90', 'M5 S0',
    'G0 X10 Y0',
    'M4 S500',
    'G3 X0 Y10 R10',   // R-mode, short CCW arc
    'M5 S0', 'M2',
  ].join('\n');
  const r = analyzeEmittedBurnEnvelope(gcode);
  assert(r.burnBounds !== null, 'G3 +R quarter: burnBounds set');
  if (r.burnBounds) {
    // Center (0,0), radius 10, sweep 90° from (10,0) to (0,10).
    // Sweep covers only the (0,10) compass point.
    // AABB: x ∈ [0, 10], y ∈ [0, 10].
    assert(nearlyEq(r.burnBounds.minX, 0), `R+G3 quarter: minX === 0`);
    assert(nearlyEq(r.burnBounds.maxX, 10), `R+G3 quarter: maxX === 10`);
    assert(nearlyEq(r.burnBounds.minY, 0), `R+G3 quarter: minY === 0`);
    assert(nearlyEq(r.burnBounds.maxY, 10), `R+G3 quarter: maxY === 10`);
  }
}

// -------- 2. Same endpoints, G3 -R: long CCW arc (270°), center at (10,10) --------
{
  // G3 -R: long-way CCW arc. From (10,0) CCW long way to (0,10) with
  // |R|=10. The center sits on the OPPOSITE side of the chord from
  // the short arc, at (10,10). Sweep from angle -π/2 CCW to π = 270°.
  // Compass points at 0, π/2, π all in range → AABB extends to
  // (20,10), (10,20), (0,10). Combined with endpoints: x ∈ [0, 20],
  // y ∈ [0, 20].
  const gcode = [
    'G21', 'G90', 'M5 S0',
    'G0 X10 Y0',
    'M4 S500',
    'G3 X0 Y10 R-10',
    'M5 S0', 'M2',
  ].join('\n');
  const r = analyzeEmittedBurnEnvelope(gcode);
  assert(r.burnBounds !== null, 'G3 -R long: burnBounds set');
  if (r.burnBounds) {
    assert(nearlyEq(r.burnBounds.minX, 0), `R-G3 long: minX === 0 (got ${r.burnBounds.minX})`);
    assert(nearlyEq(r.burnBounds.maxX, 20), `R-G3 long: maxX === 20 (compass +X at center+r)`);
    assert(nearlyEq(r.burnBounds.minY, 0), `R-G3 long: minY === 0`);
    assert(nearlyEq(r.burnBounds.maxY, 20), `R-G3 long: maxY === 20 (compass +Y)`);
  }
}

// -------- 3. G2 +R from (10,0) → (0,10): short CW arc, center at (10,10) --------
{
  // G2 +R: short CW arc. With chord (10,0)→(0,10), |R|=10 = chord/√2,
  // the chord bisects the circle; center is at (10,10). Start angle
  // -π/2, end angle π. CW from -π/2 to π = -π/2 → -π = π is a 90°
  // sweep (the short arc). The CW sweep does NOT cover compass
  // points 0 or π/2 — they would require going CCW. So AABB =
  // [endpoint X, endpoint X] × [endpoint Y, endpoint Y] = [0,10]×[0,10].
  const gcode = [
    'G21', 'G90', 'M5 S0',
    'G0 X10 Y0',
    'M4 S500',
    'G2 X0 Y10 R10',
    'M5 S0', 'M2',
  ].join('\n');
  const r = analyzeEmittedBurnEnvelope(gcode);
  assert(r.burnBounds !== null, 'G2 +R: burnBounds set');
  if (r.burnBounds) {
    assert(nearlyEq(r.burnBounds.maxX, 10), `R+G2 short: maxX === 10 (endpoint, no compass hit)`);
    assert(nearlyEq(r.burnBounds.minX, 0), `R+G2 short: minX === 0 (endpoint)`);
    assert(nearlyEq(r.burnBounds.minY, 0), `R+G2 short: minY === 0`);
    assert(nearlyEq(r.burnBounds.maxY, 10), `R+G2 short: maxY === 10`);
  }
}

// -------- 4. Bad R: chord longer than diameter → AABB still has endpoints --------
{
  // Chord from (0,0) to (10,0) is 10mm. R=2 means diameter 4 < chord 10.
  // GRBL would error; our parser falls back to endpoint-only AABB.
  const gcode = [
    'G21', 'G90', 'M5 S0',
    'G0 X0 Y0',
    'M4 S500',
    'G3 X10 Y0 R2',  // invalid (R < chord/2)
    'M5 S0', 'M2',
  ].join('\n');
  const r = analyzeEmittedBurnEnvelope(gcode);
  assert(r.burnMoveCount === 1, 'bad R: still counted as 1 burn move (endpoint-only)');
  if (r.burnBounds) {
    // Endpoint-only: x ∈ [0, 10], y ∈ {0}.
    assert(nearlyEq(r.burnBounds.minX, 0), `bad R: minX === 0`);
    assert(nearlyEq(r.burnBounds.maxX, 10), `bad R: maxX === 10`);
    assert(nearlyEq(r.burnBounds.minY, 0) && nearlyEq(r.burnBounds.maxY, 0), 'bad R: Y collapses to 0');
  }
}

// -------- 5. R and I/J both present: I/J wins (T1-189 contract: R only when I/J absent) --------
{
  // If a malformed gcode sets both R and I/J, the parser uses I/J.
  // This matches GRBL behavior — GRBL itself errors on the
  // combination but the safest parser behavior is to prefer the
  // explicit center.
  const gcode = [
    'G21', 'G90', 'M5 S0',
    'G0 X10 Y0',
    'M4 S500',
    'G3 X0 Y10 R5 I-10 J0',  // R=5 (would be short), I/J = center (0,0) → quarter arc
    'M5 S0', 'M2',
  ].join('\n');
  const r = analyzeEmittedBurnEnvelope(gcode);
  if (r.burnBounds) {
    // I/J center (0,0) + radius 10 = the same quarter arc as test 1.
    assert(nearlyEq(r.burnBounds.maxX, 10), 'R + I/J: I/J takes precedence (maxX = 10)');
    assert(nearlyEq(r.burnBounds.maxY, 10), 'R + I/J: maxY = 10');
    assert(nearlyEq(r.burnBounds.minX, 0), 'R + I/J: minX = 0');
    assert(nearlyEq(r.burnBounds.minY, 0), 'R + I/J: minY = 0');
  }
}

// -------- 6. Source pins on the implementation --------
{
  const src = readFileSync(resolve(here, '../src/core/output/emittedBurnEnvelope.ts'), 'utf-8');
  assert(/T1-189/.test(src), 'emittedBurnEnvelope.ts carries T1-189 marker');
  assert(
    /function centerFromRMode/.test(src),
    'centerFromRMode helper present',
  );
  assert(
    /words\.R !== undefined && words\.I === undefined && words\.J === undefined/.test(src),
    'R-mode branch gated on R present AND I/J absent',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
