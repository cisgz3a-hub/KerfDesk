/**
 * T1-186: arc (G2/G3) support in `analyzeEmittedBurnEnvelope`.
 *
 * Pre-T1-186 the parser only handled G0/G1; G2/G3 were silently
 * dropped. T1-186 extends the parser so that arc burn moves
 * contribute their TRUE bounding box (which can extend beyond the
 * endpoints when an axis-aligned compass extremum lies on the
 * swept range).
 *
 * Arc geometry:
 *   - G2 = clockwise arc; G3 = counter-clockwise arc.
 *   - I, J = offsets from the current position to the arc CENTER.
 *     I / J are CENTER-relative regardless of distance mode (GRBL
 *     spec; G91 affects X/Y, not I/J).
 *   - The arc's bounding box extends to (cx±r, cy) and (cx, cy±r)
 *     ONLY for those compass points that lie on the swept arc
 *     range.
 *
 * Run: npx tsx tests/emitted-burn-envelope-arcs.test.ts
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

console.log('\n=== T1-186 emitted-burn-envelope arc support (G2/G3) ===\n');

// -------- 1. Full circle G3 from (10,0) back to (10,0) via center (0,0) --------
// Sweep covers all four compass points: (10,0), (0,10), (-10,0), (0,-10).
// AABB should be [-10, 10] × [-10, 10].
{
  const gcode = [
    'G21', 'G90', 'M5 S0',
    'G0 X10 Y0',
    'M4 S500',
    'G3 X10 Y0 I-10 J0',  // full CCW circle, center (0,0), radius 10
    'M5 S0', 'M2',
  ].join('\n');
  const r = analyzeEmittedBurnEnvelope(gcode);
  assert(r.burnMoveCount === 1, 'full-circle: 1 arc burn move');
  assert(r.burnBounds !== null, 'full-circle: burnBounds set');
  if (r.burnBounds) {
    assert(nearlyEq(r.burnBounds.minX, -10), `full-circle minX === -10 (got ${r.burnBounds.minX})`);
    assert(nearlyEq(r.burnBounds.maxX, 10), `full-circle maxX === 10 (got ${r.burnBounds.maxX})`);
    assert(nearlyEq(r.burnBounds.minY, -10), `full-circle minY === -10`);
    assert(nearlyEq(r.burnBounds.maxY, 10), `full-circle maxY === 10`);
  }
}

// -------- 2. Quarter-arc G3 from (10,0) → (0,10), CCW, center (0,0) --------
// Sweep covers only the (0,10) compass point in addition to the
// endpoints. AABB should be x ∈ [0, 10], y ∈ [0, 10].
{
  const gcode = [
    'G21', 'G90', 'M5 S0',
    'G0 X10 Y0',
    'M4 S500',
    'G3 X0 Y10 I-10 J0',
    'M5 S0', 'M2',
  ].join('\n');
  const r = analyzeEmittedBurnEnvelope(gcode);
  assert(r.burnBounds !== null, 'quarter-arc CCW: burnBounds set');
  if (r.burnBounds) {
    assert(nearlyEq(r.burnBounds.minX, 0), `CCW quarter: minX === 0`);
    assert(nearlyEq(r.burnBounds.maxX, 10), `CCW quarter: maxX === 10`);
    assert(nearlyEq(r.burnBounds.minY, 0), `CCW quarter: minY === 0`);
    assert(nearlyEq(r.burnBounds.maxY, 10), `CCW quarter: maxY === 10`);
  }
}

// -------- 3. Same endpoints, opposite direction (G2): different AABB --------
// G2 from (10,0) → (0,10) is the LONG way (270° CW) through
// (10,0) → (0,-10) → (-10,0) → (0,10). Sweep covers 3 compass
// points: (0,-10), (-10,0), and (0,10) — full envelope [-10, 10] in
// both X and Y EXCEPT the missing maxX = 10 contributed only by the
// start point.
// Wait — start point (10,0) IS in the AABB regardless. So AABB
// covers [-10, 10] × [-10, 10] for the long-way CW arc.
{
  const gcode = [
    'G21', 'G90', 'M5 S0',
    'G0 X10 Y0',
    'M4 S500',
    'G2 X0 Y10 I-10 J0',  // CW = long way around (270°)
    'M5 S0', 'M2',
  ].join('\n');
  const r = analyzeEmittedBurnEnvelope(gcode);
  assert(r.burnBounds !== null, 'long-way CW: burnBounds set');
  if (r.burnBounds) {
    assert(nearlyEq(r.burnBounds.minX, -10), `CW long way: minX === -10 (got ${r.burnBounds.minX})`);
    assert(nearlyEq(r.burnBounds.maxX, 10), `CW long way: maxX === 10`);
    assert(nearlyEq(r.burnBounds.minY, -10), `CW long way: minY === -10`);
    assert(nearlyEq(r.burnBounds.maxY, 10), `CW long way: maxY === 10`);
  }
}

// -------- 4. Arc with laser off: NOT counted, bounds not expanded --------
{
  const gcode = [
    'G21', 'G90', 'M5 S0',
    'G0 X10 Y0',
    'M4 S0',              // laser modal active, but S=0 → off
    'G3 X10 Y0 I-10 J0',
    'M5 S0', 'M2',
  ].join('\n');
  const r = analyzeEmittedBurnEnvelope(gcode);
  assert(r.burnMoveCount === 0, 'laser-off arc: not counted as burn');
  assert(r.burnBounds === null, 'laser-off arc: bounds null');
}

// -------- 5. Modal G3 on subsequent line: arc inherits motionMode --------
{
  const gcode = [
    'G21', 'G90', 'M5 S0',
    'G0 X10 Y0',
    'M4 S500',
    'G3 X0 Y10 I-10 J0',   // explicit G3
    'X-10 Y0 I0 J-10',     // modal G3 inherited; second quarter arc
    'M5 S0', 'M2',
  ].join('\n');
  const r = analyzeEmittedBurnEnvelope(gcode);
  assert(r.burnMoveCount === 2, `modal G3: 2 arc burns (got ${r.burnMoveCount})`);
  if (r.burnBounds) {
    // Combined: half-circle from (10,0) → (0,10) → (-10,0).
    assert(nearlyEq(r.burnBounds.minX, -10), `modal: minX === -10`);
    assert(nearlyEq(r.burnBounds.maxX, 10), `modal: maxX === 10`);
    assert(nearlyEq(r.burnBounds.minY, 0), `modal: minY === 0 (lower half not swept)`);
    assert(nearlyEq(r.burnBounds.maxY, 10), `modal: maxY === 10`);
  }
}

// -------- 6. Source pins on the parser implementation --------
{
  const src = readFileSync(resolve(here, '../src/core/output/emittedBurnEnvelope.ts'), 'utf-8');
  assert(/T1-186/.test(src), 'emittedBurnEnvelope.ts carries T1-186 marker');
  assert(
    /motionMode:.*'G2'.*'G3'|'G0'.*'G1'.*'G2'.*'G3'/.test(src),
    'motionMode union expanded to include G2 / G3',
  );
  assert(
    /expandWithArc\(/.test(src),
    'expandWithArc helper present',
  );
  assert(
    /containsAngle/.test(src),
    'arc-helper has the containsAngle predicate',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
