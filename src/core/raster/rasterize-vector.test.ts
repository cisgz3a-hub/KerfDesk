import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Bounds, Polyline } from '../scene';
import { inkLumaForBrightnessPercent, rasterizeVectorToLuma } from './rasterize-vector';

// 127, not 128 — must stay strictly below ditherThreshold's default cutoff
// so converted bitmaps actually burn (M7).
const INK = 127;
const BG = 255;
const FUZZ_RUNS = 100;
// 25.4 = MM_PER_INCH, so this DPI gives exactly 1 px per mm — keeps test
// geometry readable (mm coordinates equal pixel coordinates).
const DPI_1PX_PER_MM = 25.4;

function bounds(minX: number, minY: number, maxX: number, maxY: number): Bounds {
  return { minX, minY, maxX, maxY };
}

function closedSquare(minX: number, minY: number, maxX: number, maxY: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
  };
}

function openLine(x1: number, y1: number, x2: number, y2: number): Polyline {
  return {
    closed: false,
    points: [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ],
  };
}

function lumaAt(r: { luma: Uint8Array; width: number }, x: number, y: number): number {
  return r.luma[y * r.width + x] ?? -1;
}

describe('rasterizeVectorToLuma (Fill All)', () => {
  it('derives pixel dimensions from mm bounds × dpi', () => {
    // 10 mm at 1 px/mm → 10 px.
    const r = rasterizeVectorToLuma({
      polylines: [],
      bounds: bounds(0, 0, 10, 10),
      dpi: DPI_1PX_PER_MM,
    });
    expect(r.width).toBe(10);
    expect(r.height).toBe(10);
    expect(r.luma.length).toBe(100);
  });

  it('doubling dpi doubles each pixel dimension', () => {
    const lo = rasterizeVectorToLuma({
      polylines: [],
      bounds: bounds(0, 0, 10, 5),
      dpi: DPI_1PX_PER_MM,
    });
    const hi = rasterizeVectorToLuma({
      polylines: [],
      bounds: bounds(0, 0, 10, 5),
      dpi: DPI_1PX_PER_MM * 2,
    });
    expect([hi.width, hi.height]).toEqual([lo.width * 2, lo.height * 2]);
  });

  it('no contours → entirely background (white)', () => {
    const r = rasterizeVectorToLuma({
      polylines: [],
      bounds: bounds(0, 0, 10, 10),
      dpi: DPI_1PX_PER_MM,
    });
    expect([...r.luma].every((v) => v === BG)).toBe(true);
  });

  it('a closed square fills its interior with ink, leaves outside white', () => {
    const sq = closedSquare(2, 2, 8, 8);
    const r = rasterizeVectorToLuma({
      polylines: [sq],
      bounds: bounds(0, 0, 10, 10),
      dpi: DPI_1PX_PER_MM,
    });
    expect(lumaAt(r, 5, 5)).toBe(INK); // interior
    expect(lumaAt(r, 0, 0)).toBe(BG); // outside the square
  });

  it('even-odd: an inner contour cuts a hole', () => {
    const outer = closedSquare(0, 0, 10, 10);
    const inner = closedSquare(3, 3, 7, 7);
    const r = rasterizeVectorToLuma({
      polylines: [outer, inner],
      bounds: bounds(0, 0, 10, 10),
      dpi: DPI_1PX_PER_MM,
    });
    expect(lumaAt(r, 1, 5)).toBe(INK); // ring between the two squares
    expect(lumaAt(r, 5, 5)).toBe(BG); // hole centre
  });

  it('open polylines do not fill (Fill All needs closed shapes)', () => {
    const open: Polyline = {
      closed: false,
      points: [
        { x: 1, y: 1 },
        { x: 9, y: 1 },
        { x: 9, y: 9 },
      ],
    };
    const r = rasterizeVectorToLuma({
      polylines: [open],
      bounds: bounds(0, 0, 10, 10),
      dpi: DPI_1PX_PER_MM,
    });
    expect([...r.luma].every((v) => v === BG)).toBe(true);
  });

  it('Outlines renders an open stroke instead of dropping it', () => {
    const r = rasterizeVectorToLuma({
      polylines: [openLine(1, 5, 9, 5)],
      bounds: bounds(0, 0, 10, 10),
      dpi: DPI_1PX_PER_MM,
      renderType: 'outlines',
    });
    const inked = [...r.luma].filter((v) => v === INK).length;
    expect(inked).toBeGreaterThan(0);
    expect(lumaAt(r, 5, 5)).toBe(INK);
  });

  it('degenerate input degrades to a 1×1 white pixel, not a throw', () => {
    const r = rasterizeVectorToLuma({ polylines: [], bounds: bounds(0, 0, 0, 0), dpi: 0 });
    expect([r.width, r.height, r.luma.length]).toEqual([1, 1, 1]);
    expect(lumaAt(r, 0, 0)).toBe(BG);
  });

  it('every output pixel is exactly ink or background', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ x: fc.integer({ min: 0, max: 20 }), y: fc.integer({ min: 0, max: 20 }) }),
          { minLength: 3, maxLength: 8 },
        ),
        (points) => {
          const r = rasterizeVectorToLuma({
            polylines: [{ closed: true, points }],
            bounds: bounds(0, 0, 20, 20),
            dpi: DPI_1PX_PER_MM,
          });
          return [...r.luma].every((v) => v === INK || v === BG);
        },
      ),
      { numRuns: FUZZ_RUNS },
    );
  });

  it('is deterministic for identical input', () => {
    const sq = closedSquare(2, 2, 8, 8);
    const input = { polylines: [sq], bounds: bounds(0, 0, 10, 10), dpi: 37 };
    const a = rasterizeVectorToLuma(input);
    const b = rasterizeVectorToLuma(input);
    expect([...a.luma]).toEqual([...b.luma]);
  });
});

// M7 (AUDIT-2026-06-10): both boundary behaviors were individually pinned -
// ink = 50% gray, and threshold burns strictly below the cutoff - but they
// COMPOSED to zero output: 128 < 128 is false, so a converted bitmap on a
// Threshold layer dithered to all-zero S (silent drop in mixed jobs, a
// misleading "produced no cuts" preflight for image-only jobs).
describe('converted-bitmap ink composes with the dither pipeline (M7)', () => {
  it('ink pixels produce a burn under the default Threshold dither', async () => {
    const { dither } = await import('./dither');
    const r = rasterizeVectorToLuma({
      polylines: [closedSquare(0, 0, 10, 10)],
      bounds: bounds(0, 0, 10, 10),
      dpi: DPI_1PX_PER_MM,
    });
    const s = dither(
      { luma: r.luma, width: r.width, height: r.height },
      { algorithm: 'threshold', sMax: 300, sMin: 0 },
    );
    expect(Array.from(s)).toContain(300);
  });
});

// A5 Default Brightness (LightBurn §7.4): converted pixels default to 50%
// gray but the operator can pick another brightness.
describe('Default Brightness → ink luma (A5)', () => {
  it('maps 50% to 127, strictly below the default threshold cutoff (M7)', () => {
    expect(inkLumaForBrightnessPercent(50)).toBe(127);
  });

  it('maps the extremes and clamps out-of-range input', () => {
    expect(inkLumaForBrightnessPercent(0)).toBe(0);
    expect(inkLumaForBrightnessPercent(100)).toBe(255);
    expect(inkLumaForBrightnessPercent(-20)).toBe(0);
    expect(inkLumaForBrightnessPercent(140)).toBe(255);
    expect(inkLumaForBrightnessPercent(Number.NaN)).toBe(127);
  });

  it('rasterizes fill and outline ink at the requested luma', () => {
    const darkInk = inkLumaForBrightnessPercent(70); // floor(255 × 0.7) = 178
    const r = rasterizeVectorToLuma({
      polylines: [closedSquare(2, 2, 8, 8)],
      bounds: bounds(0, 0, 10, 10),
      dpi: DPI_1PX_PER_MM,
      inkLuma: darkInk,
    });
    expect(darkInk).toBe(178);
    expect(lumaAt(r, 5, 5)).toBe(178);
    expect(lumaAt(r, 0, 0)).toBe(BG);
  });
});

// M4 (AUDIT-2026-06-10): fill-hatching accepts closed=false polylines whose
// endpoints coincide (real data-at-rest: autosave-restored opentype glyphs),
// but Convert to Bitmap dropped them with no fallback - Fill worked on the
// object while conversion produced an all-white bitmap with a success toast.
describe('geometric closure fallback (M4)', () => {
  it('fills a contour whose endpoints coincide even when closed=false', () => {
    const sq: Polyline = {
      closed: false,
      points: [
        { x: 2, y: 2 },
        { x: 8, y: 2 },
        { x: 8, y: 8 },
        { x: 2, y: 8 },
        { x: 2, y: 2 },
      ],
    };
    const r = rasterizeVectorToLuma({
      polylines: [sq],
      bounds: bounds(0, 0, 10, 10),
      dpi: DPI_1PX_PER_MM,
    });
    expect(lumaAt(r, 5, 5)).toBe(INK);
  });

  it('still ignores genuinely open polylines in fill mode', () => {
    const r = rasterizeVectorToLuma({
      polylines: [openLine(0, 5, 10, 5)],
      bounds: bounds(0, 0, 10, 10),
      dpi: DPI_1PX_PER_MM,
    });
    expect([...r.luma].every((v) => v === BG)).toBe(true);
  });
});
