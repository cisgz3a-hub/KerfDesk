import { describe, expect, it } from 'vitest';
import {
  clampPxPerMm,
  fitView,
  MAX_PX_PER_MM,
  MIN_PX_PER_MM,
  mmToPx,
  pxToMm,
  zoomAt,
} from './design-view';
import type { DesignView } from './design-session';

const view: DesignView = { pxPerMm: 4, panXmm: 10, panYmm: 20 };

describe('mmToPx and pxToMm', () => {
  it('are exact inverses', () => {
    const point = { x: 123.456, y: -78.9 };
    const round = pxToMm(view, mmToPx(view, point));
    expect(round.x).toBeCloseTo(point.x, 9);
    expect(round.y).toBeCloseTo(point.y, 9);
  });

  it('places the pan origin at the top-left pixel', () => {
    expect(mmToPx(view, { x: 10, y: 20 })).toEqual({ x: 0, y: 0 });
  });

  it('scales by pxPerMm', () => {
    expect(mmToPx(view, { x: 20, y: 20 })).toEqual({ x: 40, y: 0 });
  });
});

describe('clampPxPerMm', () => {
  it('bounds the zoom range and survives non-finite input', () => {
    expect(clampPxPerMm(1e9)).toBe(MAX_PX_PER_MM);
    expect(clampPxPerMm(0)).toBe(MIN_PX_PER_MM);
    expect(clampPxPerMm(Number.NaN)).toBe(1);
  });
});

describe('fitView', () => {
  const fitted = fitView({
    widthMm: 400,
    heightMm: 300,
    originXmm: 0,
    originYmm: 0,
    viewportWidthPx: 800,
    viewportHeightPx: 600,
  });

  it('fits the content inside the viewport with a margin', () => {
    expect(fitted.pxPerMm).toBeLessThan(2);
    expect(fitted.pxPerMm).toBeGreaterThan(1.5);
  });

  it('centres the content', () => {
    const topLeft = mmToPx(fitted, { x: 0, y: 0 });
    const bottomRight = mmToPx(fitted, { x: 400, y: 300 });
    expect(topLeft.x).toBeCloseTo(800 - bottomRight.x, 6);
    expect(topLeft.y).toBeCloseTo(600 - bottomRight.y, 6);
  });

  it('survives a degenerate viewport without producing NaN', () => {
    const degenerate = fitView({
      widthMm: 0,
      heightMm: 0,
      originXmm: 0,
      originYmm: 0,
      viewportWidthPx: 0,
      viewportHeightPx: 0,
    });
    expect(Number.isFinite(degenerate.pxPerMm)).toBe(true);
    expect(Number.isFinite(degenerate.panXmm)).toBe(true);
    expect(Number.isFinite(degenerate.panYmm)).toBe(true);
  });
});

describe('zoomAt', () => {
  it('keeps the millimetre under the anchor pixel fixed', () => {
    const anchor = { x: 300, y: 180 };
    const before = pxToMm(view, anchor);
    const after = pxToMm(zoomAt(view, anchor, 2.5), anchor);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('returns the same view when already clamped at the limit', () => {
    const maxed: DesignView = { ...view, pxPerMm: MAX_PX_PER_MM };
    expect(zoomAt(maxed, { x: 0, y: 0 }, 2)).toBe(maxed);
  });
});
