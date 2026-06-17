// Unit + property tests for scan-offset (ADR-052). No emitter is involved —
// this pins the interpolation math and the along-travel shift geometry in
// isolation, before any wiring changes G-code (the step-2 diff). Mirrors the
// fuzz discipline of emit-raster.property / grbl-strategy.property.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { offsetForSpeed, shiftAlongTravel, type ScanOffsetPoint } from './scan-offset';

const FUZZ_RUNS = 100;

describe('offsetForSpeed', () => {
  const table: ReadonlyArray<ScanOffsetPoint> = [
    { speedMmPerMin: 3000, offsetMm: 0.04 },
    { speedMmPerMin: 6000, offsetMm: 0.09 },
    { speedMmPerMin: 12000, offsetMm: 0.2 },
  ];
  const MAX_OFFSET_MM = 0.2;

  it('returns 0 for an empty table (feature disabled)', () => {
    expect(offsetForSpeed([], 6000)).toBe(0);
  });

  it('returns 0 for non-positive speed (no motion, no lag)', () => {
    expect(offsetForSpeed(table, 0)).toBe(0);
    expect(offsetForSpeed(table, -100)).toBe(0);
  });

  it('returns the exact offset at a calibration point', () => {
    expect(offsetForSpeed(table, 3000)).toBeCloseTo(0.04, 10);
    expect(offsetForSpeed(table, 6000)).toBeCloseTo(0.09, 10);
    expect(offsetForSpeed(table, 12000)).toBeCloseTo(0.2, 10);
  });

  it('interpolates linearly between points', () => {
    expect(offsetForSpeed(table, 4500)).toBeCloseTo(0.065, 10); // mid 3000..6000
    expect(offsetForSpeed(table, 9000)).toBeCloseTo(0.145, 10); // mid 6000..12000
  });

  it('scales linearly from rest below the first point', () => {
    expect(offsetForSpeed(table, 1500)).toBeCloseTo(0.02, 10); // half speed -> half offset
  });

  it('clamps to the last offset above the last point', () => {
    expect(offsetForSpeed(table, 20000)).toBeCloseTo(0.2, 10);
    expect(offsetForSpeed(table, 1e9)).toBeCloseTo(0.2, 10);
  });

  it('handles a single-point table (rest -> point, then clamp)', () => {
    const one: ReadonlyArray<ScanOffsetPoint> = [{ speedMmPerMin: 5000, offsetMm: 0.1 }];
    expect(offsetForSpeed(one, 2500)).toBeCloseTo(0.05, 10);
    expect(offsetForSpeed(one, 5000)).toBeCloseTo(0.1, 10);
    expect(offsetForSpeed(one, 9999)).toBeCloseTo(0.1, 10);
  });

  it('property: result stays within [0, max offset] for any speed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50000 }), (speed) => {
        const result = offsetForSpeed(table, speed);
        return result >= 0 && result <= MAX_OFFSET_MM + 1e-9;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it('property: monotonic non-decreasing in speed for an ascending-offset table', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30000 }),
        fc.integer({ min: 0, max: 20000 }),
        (a, delta) => offsetForSpeed(table, a + delta) >= offsetForSpeed(table, a) - 1e-9,
      ),
      { numRuns: FUZZ_RUNS },
    );
  });
});

describe('shiftAlongTravel', () => {
  it('is the identity when the offset is zero', () => {
    const from = { x: 1, y: 2 };
    const to = { x: 5, y: 2 };
    expect(shiftAlongTravel(from, to, 0)).toEqual({ from, to });
  });

  it('is the identity for a zero-length sweep', () => {
    const p = { x: 3, y: 3 };
    expect(shiftAlongTravel(p, p, 0.5)).toEqual({ from: p, to: p });
  });

  it('shifts a forward (left->right) row along +x', () => {
    expect(shiftAlongTravel({ x: 10, y: 5 }, { x: 20, y: 5 }, 0.1)).toEqual({
      from: { x: 10.1, y: 5 },
      to: { x: 20.1, y: 5 },
    });
  });

  it('shifts a reverse (right->left) row along -x (opposite sign, same flag)', () => {
    const shifted = shiftAlongTravel({ x: 20, y: 5 }, { x: 10, y: 5 }, 0.1);
    expect(shifted.from.x).toBeCloseTo(19.9, 10);
    expect(shifted.to.x).toBeCloseTo(9.9, 10);
  });

  it('shifts along a 45-degree hatch vector, not just x', () => {
    const shifted = shiftAlongTravel({ x: 0, y: 0 }, { x: 10, y: 10 }, Math.SQRT2);
    expect(shifted.from.x).toBeCloseTo(1, 10);
    expect(shifted.from.y).toBeCloseTo(1, 10);
    expect(shifted.to.x).toBeCloseTo(11, 10);
    expect(shifted.to.y).toBeCloseTo(11, 10);
  });

  it('property: rigid translation — preserves length and moves each end by |offset|', () => {
    const arbPt = fc.record({
      x: fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
      y: fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
    });
    fc.assert(
      fc.property(
        arbPt,
        arbPt,
        fc.double({ min: -2, max: 2, noNaN: true, noDefaultInfinity: true }),
        (from, to, offsetMm) => {
          const lenBefore = Math.hypot(to.x - from.x, to.y - from.y);
          // Assert over meaningful sweeps only: a sub-micron segment cannot carry
          // a representable direction (its unit vector underflows). Real fill/raster
          // sweeps are clamped far above this (MIN_HATCH_SPACING_MM, pixel widths);
          // the zero-length and zero-offset identities are pinned by unit tests above.
          fc.pre(lenBefore > 1e-6);
          const shifted = shiftAlongTravel(from, to, offsetMm);
          const lenAfter = Math.hypot(shifted.to.x - shifted.from.x, shifted.to.y - shifted.from.y);
          const moved = Math.hypot(shifted.from.x - from.x, shifted.from.y - from.y);
          const lenOk = Math.abs(lenAfter - lenBefore) <= 1e-9 * (1 + lenBefore);
          const movedOk = Math.abs(moved - Math.abs(offsetMm)) <= 1e-9 * (1 + Math.abs(offsetMm));
          return lenOk && movedOk;
        },
      ),
      { numRuns: FUZZ_RUNS },
    );
  });
});
