import { describe, expect, it } from 'vitest';
import { applyOrthoMm, snapToGridMm } from './design-snap';

describe('snapToGridMm', () => {
  it('rounds to the nearest grid intersection', () => {
    expect(snapToGridMm({ x: 12.4, y: 27.6 }, { enabled: true, gridMm: 10 })).toEqual({
      x: 10,
      y: 30,
    });
  });

  it('passes the point through when snapping is off', () => {
    const point = { x: 12.4, y: 27.6 };
    expect(snapToGridMm(point, { enabled: false, gridMm: 10 })).toBe(point);
  });

  it('passes through rather than dividing by zero on a bad grid', () => {
    const point = { x: 1.5, y: 2.5 };
    expect(snapToGridMm(point, { enabled: true, gridMm: 0 })).toBe(point);
    expect(snapToGridMm(point, { enabled: true, gridMm: Number.NaN })).toBe(point);
  });

  it('handles negative coordinates symmetrically', () => {
    expect(snapToGridMm({ x: -12.4, y: -27.6 }, { enabled: true, gridMm: 10 })).toEqual({
      x: -10,
      y: -30,
    });
  });
});

describe('applyOrthoMm', () => {
  const anchor = { x: 100, y: 100 };

  it('locks to the axis the pointer travelled further along', () => {
    expect(applyOrthoMm(anchor, { x: 150, y: 110 }, true)).toEqual({ x: 150, y: 100 });
    expect(applyOrthoMm(anchor, { x: 110, y: 150 }, true)).toEqual({ x: 100, y: 150 });
  });

  it('prefers horizontal on an exact tie, deterministically', () => {
    expect(applyOrthoMm(anchor, { x: 120, y: 120 }, true)).toEqual({ x: 120, y: 100 });
  });

  it('passes the point through when ortho is off', () => {
    const point = { x: 150, y: 110 };
    expect(applyOrthoMm(anchor, point, false)).toBe(point);
  });
});
