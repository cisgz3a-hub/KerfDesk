import { describe, expect, it } from 'vitest';
import type { CurveSubpath } from '../scene';
import type { TracedLayer, TracedSvgPage } from './batch-trace-svg';
import {
  fittedPageBox,
  MIN_TRACED_PAGE_SIDE_MM,
  placeTracedLayers,
  TRACED_HAIRLINE_MM,
} from './traced-page-box';

// Page units (mm here). A closed cubic dome whose control points reach y = 10
// while the curve peaks at y = 15 (t = 1/2), on a straight base at y = 30.
const DOME: CurveSubpath = {
  start: { x: 20, y: 30 },
  closed: true,
  segments: [
    { kind: 'cubic', control1: { x: 20, y: 10 }, control2: { x: 70, y: 10 }, to: { x: 70, y: 30 } },
    { kind: 'line', to: { x: 20, y: 30 } },
  ],
};
const LAYERS: ReadonlyArray<TracedLayer> = [{ color: '#000000', curves: [DOME] }];
const MM_PAGE: TracedSvgPage = {
  pixelWidth: 200,
  pixelHeight: 100,
  physicalSizeMm: { widthMm: 100, heightMm: 50 },
};

describe('fittedPageBox', () => {
  it('uses the exact curve extent, not the control points', () => {
    expect(fittedPageBox(LAYERS, MM_PAGE, 'filled-contours', 0, 0.01)).toEqual({
      minX: 20,
      minY: 15,
      maxX: 70,
      maxY: 30,
    });
  });

  it('adds the margin on every side and rounds outward to the export grid', () => {
    expect(fittedPageBox(LAYERS, MM_PAGE, 'filled-contours', 0.26, 0.1)).toEqual({
      minX: 19.7,
      minY: 14.7,
      maxX: 70.3,
      maxY: 30.3,
    });
  });

  it('adds half the widest hairline around stroked artwork', () => {
    // 0.5 mm pixels are wider than the 0.1 mm PDF/EPS hairline.
    expect(fittedPageBox(LAYERS, MM_PAGE, 'centerline', 0, 0.01)).toEqual({
      minX: 19.75,
      minY: 14.75,
      maxX: 70.25,
      maxY: 30.25,
    });
    const finePixels: TracedSvgPage = { ...MM_PAGE, physicalSizeMm: { widthMm: 2, heightMm: 1 } };
    const half = TRACED_HAIRLINE_MM / 2;
    expect(fittedPageBox(LAYERS, finePixels, 'centerline', 0, 0.01)?.minX).toBeCloseTo(20 - half);
  });

  it('takes the margin in pixels on a page with no physical size, without a grid', () => {
    const pixels: TracedSvgPage = { pixelWidth: 200, pixelHeight: 100 };
    expect(fittedPageBox(LAYERS, pixels, 'filled-contours', 2.5, 0.1)).toEqual({
      minX: 17.5,
      minY: 12.5,
      maxX: 72.5,
      maxY: 32.5,
    });
  });

  it('ignores a negative or non-finite margin and returns null with nothing to fit', () => {
    expect(fittedPageBox(LAYERS, MM_PAGE, 'filled-contours', -3, 0.01)?.minX).toBe(20);
    expect(fittedPageBox(LAYERS, MM_PAGE, 'filled-contours', Number.NaN, 0.01)?.minX).toBe(20);
    expect(fittedPageBox([], MM_PAGE, 'filled-contours', 1, 0.01)).toBeNull();
  });
});

describe('fittedPageBox: the 3 pt minimum page side', () => {
  // A 50 mm long, 0.2 mm tall filled bar: y 30..30.2 mm.
  const BAR: CurveSubpath = {
    start: { x: 20, y: 30 },
    closed: true,
    segments: [
      { kind: 'line', to: { x: 70, y: 30 } },
      { kind: 'line', to: { x: 70, y: 30.2 } },
      { kind: 'line', to: { x: 20, y: 30.2 } },
    ],
  };
  const bar: ReadonlyArray<TracedLayer> = [{ color: '#000000', curves: [BAR] }];

  it('is 3 pt in millimetres', () => {
    expect(MIN_TRACED_PAGE_SIDE_MM * (72 / 25.4)).toBeCloseTo(3, 12);
  });

  it('grows a thin side to 3 pt on whole grid steps, centred on the artwork', () => {
    // 3 pt = 1.0583 mm: 106 steps of 0.01 mm. The 20 steps of artwork get 43
    // steps below and 43 above, so the page is y 29.57..30.63.
    const box = fittedPageBox(bar, MM_PAGE, 'filled-contours', 0, 0.01);
    expect(box).toEqual({ minX: 20, minY: 29.57, maxX: 70, maxY: 30.63 });
    // An odd extra step goes to the high side: 1059 steps of 0.001 mm.
    const fine = fittedPageBox(bar, MM_PAGE, 'filled-contours', 0, 0.001);
    expect(fine).toEqual({ minX: 20, minY: 29.571, maxX: 70, maxY: 30.63 });
    expect((fine?.maxY ?? 0) - (fine?.minY ?? 0)).toBeGreaterThanOrEqual(MIN_TRACED_PAGE_SIDE_MM);
  });

  it('grows both sides of a single dot and keeps one step on a coarse grid', () => {
    const dot: CurveSubpath = {
      start: { x: 5, y: 5 },
      closed: false,
      segments: [{ kind: 'line', to: { x: 5, y: 5 } }],
    };
    const layers: ReadonlyArray<TracedLayer> = [{ color: '#000000', curves: [dot] }];
    const fine: TracedSvgPage = { ...MM_PAGE, physicalSizeMm: { widthMm: 2, heightMm: 1 } };
    // Stroke allowance 0.05 mm: 4.95..5.05, grown to 1.06 mm around it.
    expect(fittedPageBox(layers, fine, 'centerline', 0, 0.01)).toEqual({
      minX: 4.47,
      minY: 4.47,
      maxX: 5.53,
      maxY: 5.53,
    });
    // A 10 mm grid: one step already exceeds 3 pt.
    expect(fittedPageBox(layers, fine, 'centerline', 0, 10)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
    });
  });

  it('leaves a page with no physical size alone', () => {
    const pixels: TracedSvgPage = { pixelWidth: 200, pixelHeight: 100 };
    const box = fittedPageBox(bar, pixels, 'filled-contours', 0, 0.01);
    expect((box?.maxY ?? 0) - (box?.minY ?? 0)).toBeCloseTo(0.2, 12);
  });
});

describe('placeTracedLayers', () => {
  it('returns the image page and layers untouched by default', () => {
    const placed = placeTracedLayers(LAYERS, MM_PAGE, 'filled-contours', undefined, undefined);
    expect(placed.layers).toBe(LAYERS);
    expect(placed.page).toBe(MM_PAGE);
    expect(placeTracedLayers(LAYERS, MM_PAGE, 'filled-contours', { fit: 'image' }, 0.01).page).toBe(
      MM_PAGE,
    );
  });

  it('moves the artwork to the fitted page and keeps the image scale', () => {
    const placed = placeTracedLayers(
      LAYERS,
      MM_PAGE,
      'filled-contours',
      { fit: 'artwork', marginMm: 5 },
      0.01,
    );
    expect(placed.page).toEqual({ ...MM_PAGE, size: { width: 60, height: 25 } });
    const moved = placed.layers[0]?.curves[0];
    expect(moved?.start).toEqual({ x: 5, y: 20 });
  });
});
