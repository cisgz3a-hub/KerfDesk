import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ColoredPath, Polyline, Vec2 } from '../../core/scene';
import { createMask, rasterizeColoredPaths, rasterizePolylines } from './rasterize';
import type { Mask } from './rasterize';

// --- helpers ---------------------------------------------------------------

// Axis-aligned rectangle as a closed contour (CCW order; even-odd is
// winding-independent so order is irrelevant).
function rectClosed(x0: number, y0: number, x1: number, y1: number): Polyline {
  return {
    closed: true,
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  };
}

// Regular polygon approximating a circle. 128 sides keeps the polygon area
// within ~0.05% of πr², so we can compare pixel counts to the true disc area.
function circlePolygon(cx: number, cy: number, r: number, sides = 128): Polyline {
  const points: Vec2[] = [];
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * Math.PI * 2;
    points.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return { closed: true, points };
}

function pixelAt(mask: Mask, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 0;
  return mask.data[y * mask.width + x] ?? 0;
}

function countInk(mask: Mask): number {
  let count = 0;
  for (const v of mask.data) count += v;
  return count;
}

// --- createMask ------------------------------------------------------------

describe('createMask', () => {
  it('allocates width*height zeroed cells', () => {
    const mask = createMask(5, 3);
    expect(mask.width).toBe(5);
    expect(mask.height).toBe(3);
    expect(mask.data).toHaveLength(15);
    expect(countInk(mask)).toBe(0);
  });

  it('clamps negative dimensions to an empty buffer instead of throwing', () => {
    const mask = createMask(-4, 2);
    expect(mask.data).toHaveLength(0);
  });
});

// --- closed-contour fill ---------------------------------------------------

describe('rasterizePolylines — closed fills', () => {
  it('fills a 4×4 square covering the whole 4×4 grid exactly (16 px)', () => {
    // Vertical edges sit at x=0 and x=4. Each row centre x+0.5 in [0,4)
    // selects x=0..3, so all four rows fill all four columns.
    const mask = rasterizePolylines([rectClosed(0, 0, 4, 4)], 4, 4);
    expect(countInk(mask)).toBe(16);
    for (const v of mask.data) expect(v).toBe(1);
  });

  it('fills the integer-aligned interior [1,4)×[1,4) as a 3×3 block', () => {
    // Rect (1,1)-(4,4) on a 6×6 grid. Pixel centres in [1,4) are x,y ∈
    // {1,2,3}, so exactly the 3×3 block at (1..3, 1..3) is ink — nothing
    // outside it.
    const mask = rasterizePolylines([rectClosed(1, 1, 4, 4)], 6, 6);
    expect(countInk(mask)).toBe(9);
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        const inside = x >= 1 && x <= 3 && y >= 1 && y <= 3;
        expect(pixelAt(mask, x, y)).toBe(inside ? 1 : 0);
      }
    }
  });

  it('clips geometry that overflows the mask without writing out of bounds', () => {
    // Rect far larger than the grid: every pixel fills, nothing crashes.
    const mask = rasterizePolylines([rectClosed(-10, -10, 100, 100)], 10, 10);
    expect(countInk(mask)).toBe(100);
  });

  it('fills a disc to approximately πr²', () => {
    const r = 30;
    const cx = 40;
    const cy = 40;
    const mask = rasterizePolylines([circlePolygon(cx, cy, r)], 80, 80);
    const area = Math.PI * r * r;
    // ±5% band absorbs midpoint-scanline discretization at the caps; a
    // grossly wrong fill region would miss by far more.
    expect(countInk(mask)).toBeGreaterThan(area * 0.95);
    expect(countInk(mask)).toBeLessThan(area * 1.05);
    // Centre is ink; a far corner is background.
    expect(pixelAt(mask, cx, cy)).toBe(1);
    expect(pixelAt(mask, 5, 5)).toBe(0);
  });

  it('leaves the hole of an annulus empty (even-odd over concentric rings)', () => {
    // Outer r=30, inner r=15, shared centre. The whole point of the
    // harness: a letter "O" hole must read as background, not ink.
    const cx = 40;
    const cy = 40;
    const outerR = 30;
    const innerR = 15;
    const mask = rasterizePolylines(
      [circlePolygon(cx, cy, outerR), circlePolygon(cx, cy, innerR)],
      80,
      80,
    );
    // Dead centre and a point well inside the inner radius: empty.
    expect(pixelAt(mask, cx, cy)).toBe(0);
    expect(pixelAt(mask, cx, cy + 8)).toBe(0);
    // A point in the ring (radius ~22, between 15 and 30): ink.
    expect(pixelAt(mask, cx + 22, cy)).toBe(1);
    // Total area ≈ π(R² − r²).
    const ringArea = Math.PI * (outerR * outerR - innerR * innerR);
    expect(countInk(mask)).toBeGreaterThan(ringArea * 0.95);
    expect(countInk(mask)).toBeLessThan(ringArea * 1.05);
  });

  it('ignores closed contours with fewer than 3 points', () => {
    const twoPoint: Polyline = {
      closed: true,
      points: [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
      ],
    };
    // A 2-point "closed" contour has no area; it is stroked as an open
    // line rather than filled, so it never produces a solid region.
    const mask = rasterizePolylines([twoPoint], 10, 10);
    expect(countInk(mask)).toBeLessThanOrEqual(5);
  });
});

// --- open-polyline stroke --------------------------------------------------

describe('rasterizePolylines — open strokes', () => {
  it('draws an open horizontal polyline as a 1-px stroke', () => {
    const line: Polyline = {
      closed: false,
      points: [
        { x: 1, y: 5 },
        { x: 8, y: 5 },
      ],
    };
    const mask = rasterizePolylines([line], 10, 10);
    // x=1..8 inclusive on row 5 = 8 pixels, nothing on other rows.
    expect(countInk(mask)).toBe(8);
    for (let x = 1; x <= 8; x += 1) {
      expect(pixelAt(mask, x, 5)).toBe(1);
    }
    expect(pixelAt(mask, 4, 4)).toBe(0);
    expect(pixelAt(mask, 4, 6)).toBe(0);
  });

  it('strokes each segment of a multi-point open polyline', () => {
    const path: Polyline = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 5 },
        { x: 5, y: 5 },
      ],
    };
    const mask = rasterizePolylines([path], 10, 10);
    expect(pixelAt(mask, 0, 0)).toBe(1);
    expect(pixelAt(mask, 0, 5)).toBe(1);
    expect(pixelAt(mask, 5, 5)).toBe(1);
    // The diagonal jump (0,0)->(5,5) is NOT drawn: the corner (5,0) stays
    // empty because the path goes down then right.
    expect(pixelAt(mask, 5, 0)).toBe(0);
  });
});

// --- colour-layer union ----------------------------------------------------

describe('rasterizeColoredPaths — union', () => {
  it('ORs two non-overlapping colour layers into one mask', () => {
    const paths: ColoredPath[] = [
      { color: '#111111', polylines: [rectClosed(0, 0, 4, 4)] },
      { color: '#222222', polylines: [rectClosed(10, 0, 14, 4)] },
    ];
    const mask = rasterizeColoredPaths(paths, 20, 6);
    // Two 4×4 blocks, disjoint: 16 + 16.
    expect(countInk(mask)).toBe(32);
  });

  it('reads ink wherever ANY layer fills, even a hole another layer left', () => {
    // Layer A is an annulus (hole at centre); layer B is a small disc that
    // covers that hole. The union must report the centre as ink.
    const cx = 40;
    const cy = 40;
    const paths: ColoredPath[] = [
      {
        color: '#aaaaaa',
        polylines: [circlePolygon(cx, cy, 30), circlePolygon(cx, cy, 15)],
      },
      { color: '#bbbbbb', polylines: [circlePolygon(cx, cy, 10)] },
    ];
    const mask = rasterizeColoredPaths(paths, 80, 80);
    expect(pixelAt(mask, cx, cy)).toBe(1);
  });
});

// --- invariants ------------------------------------------------------------

describe('rasterize invariants', () => {
  it('is deterministic across two identical calls', () => {
    const build = (): Mask =>
      rasterizePolylines([circlePolygon(25, 25, 18), rectClosed(2, 2, 9, 9)], 50, 50);
    expect(build().data).toEqual(build().data);
  });

  it('property: ink count never exceeds the pixel budget and never throws', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 60, noNaN: true }),
        fc.double({ min: -20, max: 60, noNaN: true }),
        fc.double({ min: 1, max: 40, noNaN: true }),
        fc.double({ min: 1, max: 40, noNaN: true }),
        (x0, y0, w, h) => {
          const mask = rasterizePolylines([rectClosed(x0, y0, x0 + w, y0 + h)], 40, 40);
          const ink = countInk(mask);
          expect(ink).toBeGreaterThanOrEqual(0);
          expect(ink).toBeLessThanOrEqual(40 * 40);
        },
      ),
      { numRuns: 100 },
    );
  });
});
