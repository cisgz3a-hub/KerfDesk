import { describe, expect, it } from 'vitest';
import type { CurveSubpath } from '../scene';
import type { TracedLayer, TracedSvgPage } from './batch-trace-svg';
import { fittedPageBox, placeTracedLayers, TRACED_HAIRLINE_MM } from './traced-page-box';

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
    expect(fittedPageBox(LAYERS, MM_PAGE, 'fill', 0, 0.01)).toEqual({
      minX: 20,
      minY: 15,
      maxX: 70,
      maxY: 30,
    });
  });

  it('adds the margin on every side and rounds outward to the export grid', () => {
    expect(fittedPageBox(LAYERS, MM_PAGE, 'fill', 0.26, 0.1)).toEqual({
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
    expect(fittedPageBox(LAYERS, pixels, 'fill', 2.5, 0.1)).toEqual({
      minX: 17.5,
      minY: 12.5,
      maxX: 72.5,
      maxY: 32.5,
    });
  });

  it('ignores a negative or non-finite margin and returns null with nothing to fit', () => {
    expect(fittedPageBox(LAYERS, MM_PAGE, 'fill', -3, 0.01)?.minX).toBe(20);
    expect(fittedPageBox(LAYERS, MM_PAGE, 'fill', Number.NaN, 0.01)?.minX).toBe(20);
    expect(fittedPageBox([], MM_PAGE, 'fill', 1, 0.01)).toBeNull();
  });
});

describe('placeTracedLayers', () => {
  it('returns the image page and layers untouched by default', () => {
    const placed = placeTracedLayers(LAYERS, MM_PAGE, 'fill', undefined, undefined);
    expect(placed.layers).toBe(LAYERS);
    expect(placed.page).toBe(MM_PAGE);
    expect(placeTracedLayers(LAYERS, MM_PAGE, 'fill', { fit: 'image' }, 0.01).page).toBe(MM_PAGE);
  });

  it('moves the artwork to the fitted page and keeps the image scale', () => {
    const placed = placeTracedLayers(LAYERS, MM_PAGE, 'fill', { fit: 'artwork', marginMm: 5 }, 0.01);
    expect(placed.page).toEqual({ ...MM_PAGE, size: { width: 60, height: 25 } });
    const moved = placed.layers[0]?.curves[0];
    expect(moved?.start).toEqual({ x: 5, y: 20 });
  });
});
