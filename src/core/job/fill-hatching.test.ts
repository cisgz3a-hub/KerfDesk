import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { fillHatching } from './fill-hatching';

function square(side: number, originX = 0, originY = 0): Polyline {
  return {
    closed: true,
    points: [
      { x: originX, y: originY },
      { x: originX + side, y: originY },
      { x: originX + side, y: originY + side },
      { x: originX, y: originY + side },
    ],
  };
}

describe('fillHatching', () => {
  it('hatches a unit square at angle=0 spacing=0.1 to ~10 horizontal lines', () => {
    const result = fillHatching({
      polylines: [square(1)],
      hatchAngleDeg: 0,
      hatchSpacingMm: 0.1,
    });
    // 10 hatch slots in (0, 1) at spacing 0.1; allow ±1 for boundary
    // policy (we use ceil-snap on the first scanline + <= maxY).
    expect(result.length).toBeGreaterThanOrEqual(9);
    expect(result.length).toBeLessThanOrEqual(11);
    // Every hatch is a 2-point horizontal segment from x≈0 to x≈1.
    for (const pl of result) {
      expect(pl.points).toHaveLength(2);
      expect(pl.closed).toBe(false);
      const [a, b] = pl.points;
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a === undefined || b === undefined) continue;
      // Same Y on both endpoints — it's a horizontal hatch.
      expect(Math.abs(a.y - b.y)).toBeLessThan(1e-9);
      // X span ≈ 1 (the square's width).
      expect(Math.abs(Math.abs(b.x - a.x) - 1)).toBeLessThan(1e-6);
    }
  });

  it('hatches at angle=90 produces vertical lines (same count, swapped X/Y)', () => {
    const horiz = fillHatching({
      polylines: [square(1)],
      hatchAngleDeg: 0,
      hatchSpacingMm: 0.1,
    });
    const vert = fillHatching({
      polylines: [square(1)],
      hatchAngleDeg: 90,
      hatchSpacingMm: 0.1,
    });
    expect(vert.length).toBe(horiz.length);
    for (const pl of vert) {
      const [a, b] = pl.points;
      if (a === undefined || b === undefined) continue;
      // Same X on both endpoints — it's a vertical hatch.
      expect(Math.abs(a.x - b.x)).toBeLessThan(1e-6);
    }
  });

  it('alternates direction every scanline (snake fill)', () => {
    const result = fillHatching({
      polylines: [square(1)],
      hatchAngleDeg: 0,
      hatchSpacingMm: 0.1,
    });
    // First row: x goes 0 → 1 (forward). Second: 1 → 0. Etc.
    let prevDirection: 'forward' | 'backward' | null = null;
    let alternations = 0;
    for (const pl of result) {
      const [a, b] = pl.points;
      if (a === undefined || b === undefined) continue;
      const dir = b.x > a.x ? 'forward' : 'backward';
      if (prevDirection !== null && prevDirection !== dir) alternations += 1;
      prevDirection = dir;
    }
    // For 10 hatches we expect 9 alternations.
    expect(alternations).toBeGreaterThan(result.length - 2);
  });

  it('skips the hole in a "donut" (square with inner square hole)', () => {
    // Outer 10×10 square at (0,0); inner 4×4 square hole at (3,3)..(7,7).
    // At Y=5 (mid-height), scanline crosses outer at x=0,10 and inner at
    // x=3,7. Even-odd pairs: (0,3) interior, (3,7) hole-skip, (7,10)
    // interior. So Y=5 must emit exactly 2 hatch lines.
    const outer = square(10);
    const inner = square(4, 3, 3);
    // Inner contour must wind in REVERSE order for even-odd to count
    // it as a hole. Our scanline algorithm uses pure even-odd parity,
    // which is winding-order-independent — so either order works.
    const result = fillHatching({
      polylines: [outer, inner],
      hatchAngleDeg: 0,
      hatchSpacingMm: 1.0,
    });
    // Pick scanlines that cross both shapes: Y in [4, 6]. Inner spans
    // y=[3,7], outer spans y=[0,10]. At those Ys, expect 2 hatches per
    // scanline (one each side of the hole).
    const middleHatches = result.filter((pl) => {
      const y = pl.points[0]?.y;
      return y !== undefined && y >= 4 && y <= 6;
    });
    // 3 scanlines × 2 hatches = 6. Allow ±2 for boundary snap.
    expect(middleHatches.length).toBeGreaterThanOrEqual(4);
    expect(middleHatches.length).toBeLessThanOrEqual(8);
    // None of them span more than ~6mm (the donut's gap is 3mm on each
    // side; a hatch crossing the hole would span ~10mm).
    for (const pl of middleHatches) {
      const [a, b] = pl.points;
      if (a === undefined || b === undefined) continue;
      const span = Math.abs(b.x - a.x);
      expect(span).toBeLessThan(7);
    }
  });

  it('fills a polyline that returns to its start but lacks closed: true (autosave / opentype regression)', () => {
    // Autosave-restored TextObjects from before the text-to-polylines fix
    // carry polylines marked closed: false even though the contour returns
    // to its start point (opentype.js v2 emits a closing L instead of a
    // Z command). fillHatching now detects geometric closure as a
    // fallback, so old saved projects work without re-rendering the text.
    const lShapedClose: Polyline = {
      closed: false, // ← intentionally wrong; geometry says closed
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 0 }, // back to start = closed geometrically
      ],
    };
    const result = fillHatching({
      polylines: [lShapedClose],
      hatchAngleDeg: 0,
      hatchSpacingMm: 1.0,
    });
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty for open polylines (no enclosed area)', () => {
    const openLine: Polyline = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    };
    expect(fillHatching({ polylines: [openLine], hatchAngleDeg: 0, hatchSpacingMm: 0.5 })).toEqual(
      [],
    );
  });

  it('returns empty for degenerate input (fewer than 3 points)', () => {
    const twoPoint: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
    };
    expect(fillHatching({ polylines: [twoPoint], hatchAngleDeg: 0, hatchSpacingMm: 0.5 })).toEqual(
      [],
    );
  });

  it('clamps a too-small spacing rather than running forever', () => {
    // spacing=0 would normally generate an infinite scanline loop. The
    // algorithm clamps to MIN_HATCH_SPACING_MM (0.05) and returns a
    // finite-but-large hatch set instead.
    const result = fillHatching({
      polylines: [square(1)],
      hatchAngleDeg: 0,
      hatchSpacingMm: 0,
    });
    // 1mm / 0.05mm = 20 scanlines.
    expect(result.length).toBeGreaterThan(15);
    expect(result.length).toBeLessThan(25);
  });

  it('angle normalisation: 200° behaves like 20°', () => {
    const r200 = fillHatching({
      polylines: [square(5)],
      hatchAngleDeg: 200,
      hatchSpacingMm: 0.5,
    });
    const r20 = fillHatching({
      polylines: [square(5)],
      hatchAngleDeg: 20,
      hatchSpacingMm: 0.5,
    });
    expect(r200.length).toBe(r20.length);
  });

  it('property: every hatch endpoint lies inside the input bounding box', () => {
    // Doesn't prove the hatches are strictly inside the polygon (the
    // even-odd rule + scanline math handles that), but does guard against
    // a rotation-bug that flings points off into space.
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 50, noNaN: true }),
        fc.double({ min: 0.1, max: 5, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        (side, spacing, angle) => {
          const sq = square(side);
          const result = fillHatching({
            polylines: [sq],
            hatchAngleDeg: angle,
            hatchSpacingMm: spacing,
          });
          // Bounding box of the input square + a small margin for the
          // rotate-and-back float jitter.
          const margin = 1e-3;
          for (const pl of result) {
            for (const p of pl.points) {
              expect(p.x).toBeGreaterThanOrEqual(-margin);
              expect(p.x).toBeLessThanOrEqual(side + margin);
              expect(p.y).toBeGreaterThanOrEqual(-margin);
              expect(p.y).toBeLessThanOrEqual(side + margin);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('produces deterministic output across two calls on the same input', () => {
    const a = fillHatching({
      polylines: [square(7)],
      hatchAngleDeg: 45,
      hatchSpacingMm: 0.3,
    });
    const b = fillHatching({
      polylines: [square(7)],
      hatchAngleDeg: 45,
      hatchSpacingMm: 0.3,
    });
    expect(a).toEqual(b);
  });
});
