// Fast-check property tests for emitRasterGroup.
//
// Unit tests in emit-raster.test.ts pin specific behaviours against
// hand-crafted fixtures. These property tests sweep random inputs
// (100 fuzz seeds each) to catch edge cases the unit fixtures don't
// surface — particularly the F.2 raster perf optimizations (skip
// blank rows, clip active span) which have several boundary cases
// (zero-width active span, alternating rows, S-values exactly at
// the active-span edges).
//
// Mirrors the property-test discipline that grbl-strategy.property
// applies to cut groups — PROJECT.md non-negotiables #3 (laser-off
// on travel), #5 (determinism), and bounds correctness all get the
// same fuzz coverage for the raster path.

import fc from 'fast-check';
import { describe, it } from 'vitest';
import { emitRasterGroup, type EmitRasterInput } from './emit-raster';

const FUZZ_RUNS = 100;

// Arbitrary that produces a non-degenerate EmitRasterInput. Dimensions
// stay small so a 100-seed run completes in <1s; the math doesn't care
// about scale beyond `width * height` matching the buffer length.
const arbInput: fc.Arbitrary<EmitRasterInput> = fc
  .record({
    width: fc.integer({ min: 1, max: 12 }),
    height: fc.integer({ min: 1, max: 12 }),
    feedMmPerMin: fc.integer({ min: 100, max: 10000 }),
    overscanMm: fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true }),
    minX: fc.double({ min: 0, max: 200, noNaN: true, noDefaultInfinity: true }),
    minY: fc.double({ min: 0, max: 200, noNaN: true, noDefaultInfinity: true }),
    pixelMm: fc.double({ min: 0.1, max: 5, noNaN: true, noDefaultInfinity: true }),
    sMaxSeed: fc.integer({ min: 0, max: 1000 }),
    sValuesSeed: fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 144, maxLength: 144 }),
  })
  .map(({ width, height, feedMmPerMin, overscanMm, minX, minY, pixelMm, sValuesSeed }) => {
    const sValues = new Uint16Array(width * height);
    for (let i = 0; i < sValues.length; i += 1) {
      sValues[i] = sValuesSeed[i % sValuesSeed.length] ?? 0;
    }
    return {
      sValues,
      width,
      height,
      bounds: {
        minX,
        minY,
        maxX: minX + width * pixelMm,
        maxY: minY + height * pixelMm,
      },
      feedMmPerMin,
      overscanMm,
    };
  });

describe('emitRasterGroup property tests', () => {
  it('PROJECT non-negotiable #3 — every G0 carries S0 (laser-off on travel)', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const out = emitRasterGroup(input);
        const g0Lines = out.split('\n').filter((l) => l.startsWith('G0 '));
        return g0Lines.every((l) => l.includes('S0'));
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it('PROJECT non-negotiable #5 — deterministic across repeated calls', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const a = emitRasterGroup(input);
        const b = emitRasterGroup(input);
        return a === b;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  // emit-raster formats coordinates via toFixed(3); the parsed
  // numeric value can therefore differ from the source by up to
  // 0.0005 mm. The bounds check has to tolerate that — at sub-mm
  // precision it's invisible to the laser.
  const ROUND_TOLERANCE_MM = 0.0005;

  it('all X coordinates fall within [bounds.minX - overscan, bounds.maxX + overscan]', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const out = emitRasterGroup(input);
        const lowerBound = input.bounds.minX - input.overscanMm - ROUND_TOLERANCE_MM;
        const upperBound = input.bounds.maxX + input.overscanMm + ROUND_TOLERANCE_MM;
        // Match G0/G1 X… coordinates; skip the F… in case it matches.
        const xMatches = Array.from(out.matchAll(/^G[01]\s+X(-?\d+\.\d+)/gm));
        return xMatches.every((m) => {
          const x = Number.parseFloat(m[1] ?? '0');
          return x >= lowerBound && x <= upperBound;
        });
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it('all Y coordinates fall within [bounds.minY, bounds.maxY]', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const out = emitRasterGroup(input);
        const yMatches = Array.from(out.matchAll(/Y(-?\d+\.\d+)/g));
        const lowerBound = input.bounds.minY - ROUND_TOLERANCE_MM;
        const upperBound = input.bounds.maxY + ROUND_TOLERANCE_MM;
        return yMatches.every((m) => {
          const y = Number.parseFloat(m[1] ?? '0');
          return y >= lowerBound && y <= upperBound;
        });
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it('emits G0 rows only for rows with content (distinct G0 Y per content row)', () => {
    // The skip-blank-rows optimization: a row that is all-zero must produce no
    // G0 at its Y. A content row may now emit MULTIPLE G0s — one per ink island
    // (ADR-039 gap-split) — but they all share that row's Y, so the count of
    // DISTINCT G0 Y-values equals the content-row count, and blank rows
    // contribute none.
    fc.assert(
      fc.property(arbInput, (input) => {
        const out = emitRasterGroup(input);
        const g0Ys = new Set(
          Array.from(out.matchAll(/^G0\s+X-?\d+\.\d+\s+Y(-?\d+\.\d+)/gm)).map((m) => m[1]),
        );
        let nonZeroRows = 0;
        for (let y = 0; y < input.height; y += 1) {
          for (let x = 0; x < input.width; x += 1) {
            if ((input.sValues[y * input.width + x] ?? 0) !== 0) {
              nonZeroRows += 1;
              break;
            }
          }
        }
        return g0Ys.size === nonZeroRows;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });
});
