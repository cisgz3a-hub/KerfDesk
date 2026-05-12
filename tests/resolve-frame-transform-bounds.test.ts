/**
 * T2-6 Phase 3x: regression test for `resolveFrameTransformBounds`,
 * the pure helper extracted from App.tsx's inline
 * `frameTransformBounds` useMemo.
 *
 * Companion to the existing `resolveFrameSceneBounds` (T3-36). Where
 * that helper picks the SCENE-space bounds for the framing path
 * (preferring tight burn bounds), this one picks the bounds the
 * machine-axis-transform anchors on. Same fresh-compile gate as the
 * scene helper but with a narrower input surface (no burn bounds).
 *
 * What this test pins:
 *   - Pre-extraction inline ternary is preserved exactly:
 *       outputBounds unless (hasFreshCompile && usable plan bounds)
 *   - "Usable" = finite numbers, max >= min (matches the existing
 *     `isUsableFrameBounds` private predicate via the resolver).
 *   - Returns a fresh copy (not the same reference) so callers
 *     using the value as a useMemo dep don't accidentally short-
 *     circuit on a stale identity.
 *   - hasFreshCompile=false short-circuits regardless of plan-bounds
 *     content.
 *
 * Run: npx tsx tests/resolve-frame-transform-bounds.test.ts
 */
import { resolveFrameTransformBounds } from '../src/app/frameGcode';
import type { AABB } from '../src/core/types';

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

function eq(a: AABB, b: AABB): boolean {
  return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
}

const outputBounds: AABB = { minX: 0, minY: 0, maxX: 100, maxY: 80 };
const planBounds: AABB = { minX: 5, minY: 5, maxX: 60, maxY: 50 };

console.log('\n=== T2-6 Phase 3x resolveFrameTransformBounds ===\n');

// -------- 1. Happy path: fresh compile + valid plan bounds → plan --------
{
  const r = resolveFrameTransformBounds({
    outputBounds,
    compiledCanvasPlanBounds: planBounds,
    hasFreshCompile: true,
  });
  assert(eq(r, planBounds), 'fresh compile + usable plan → returns plan bounds');
}

// -------- 2. Fresh compile but no plan bounds → falls back to output --------
{
  const r = resolveFrameTransformBounds({
    outputBounds,
    compiledCanvasPlanBounds: null,
    hasFreshCompile: true,
  });
  assert(eq(r, outputBounds), 'fresh compile + null plan → falls back to output');
}

// -------- 3. Stale compile → output regardless of plan bounds --------
{
  const r = resolveFrameTransformBounds({
    outputBounds,
    compiledCanvasPlanBounds: planBounds,
    hasFreshCompile: false,
  });
  assert(eq(r, outputBounds), 'stale compile + valid plan → returns output (gate short-circuits)');
}

// -------- 4. NaN / Infinity in plan bounds → rejected, falls back to output --------
{
  for (const bad of [
    { ...planBounds, minX: Number.NaN },
    { ...planBounds, maxY: Number.POSITIVE_INFINITY },
    { ...planBounds, minY: Number.NEGATIVE_INFINITY },
  ]) {
    const r = resolveFrameTransformBounds({
      outputBounds,
      compiledCanvasPlanBounds: bad,
      hasFreshCompile: true,
    });
    assert(eq(r, outputBounds), `non-finite plan bounds rejected (${JSON.stringify(bad)})`);
  }
}

// -------- 5. Inverted plan bounds (max < min) → rejected --------
{
  const inverted: AABB = { minX: 50, minY: 0, maxX: 10, maxY: 80 };
  const r = resolveFrameTransformBounds({
    outputBounds,
    compiledCanvasPlanBounds: inverted,
    hasFreshCompile: true,
  });
  assert(eq(r, outputBounds), 'inverted plan bounds (max < min) → falls back to output');
}

// -------- 6. Result is a copy, not the same reference --------
{
  const r = resolveFrameTransformBounds({
    outputBounds,
    compiledCanvasPlanBounds: planBounds,
    hasFreshCompile: true,
  });
  assert(r !== planBounds, 'returned object is a fresh copy (not === plan reference)');
  // And the same for the output-fallback path.
  const r2 = resolveFrameTransformBounds({
    outputBounds,
    compiledCanvasPlanBounds: null,
    hasFreshCompile: true,
  });
  assert(r2 !== outputBounds, 'returned object is a fresh copy (not === output reference)');
}

// -------- 7. Behaviour preservation: matches the pre-extraction ternary --------
// Pre-T2-6-Phase-3x inline:
//   !gcodeStale && currentGcode && lastResult?.canvasPlanBounds
//     ? lastResult.canvasPlanBounds
//     : outputSceneBounds
// Map: `hasFreshCompile = !gcodeStale && Boolean(currentGcode) && lastResult != null`
// Sweep every truthy/falsy combination and verify the new helper
// matches what the ternary produced.
{
  const matrix = [
    { gcodeStale: false, gcode: 'G1', hasResult: true,  expect: planBounds   },
    { gcodeStale: true,  gcode: 'G1', hasResult: true,  expect: outputBounds },
    { gcodeStale: false, gcode: '',   hasResult: true,  expect: outputBounds },
    { gcodeStale: false, gcode: 'G1', hasResult: false, expect: outputBounds },
  ];
  for (const m of matrix) {
    const hasFreshCompile = !m.gcodeStale && Boolean(m.gcode) && m.hasResult;
    const r = resolveFrameTransformBounds({
      outputBounds,
      compiledCanvasPlanBounds: m.hasResult ? planBounds : null,
      hasFreshCompile,
    });
    assert(eq(r, m.expect),
      `matrix (stale=${m.gcodeStale}, gcode="${m.gcode}", hasResult=${m.hasResult}) → ${JSON.stringify(m.expect)}`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
