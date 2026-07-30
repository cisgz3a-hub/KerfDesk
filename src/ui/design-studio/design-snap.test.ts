import { describe, expect, it } from 'vitest';
import type { Sketch } from '../../core/design';
import { applyOrthoMm, snapKindLabel, snapPointMm, snapToGridMm } from './design-snap';

const sketch: Sketch = {
  entities: [
    {
      kind: 'rect',
      id: 'r',
      origin: { x: 100, y: 100 },
      widthMm: 60,
      heightMm: 40,
      cornerRadiusMm: 0,
    },
  ],
};

const base = {
  sketch,
  pxPerMm: 2,
  snapEnabled: true,
  gridMm: 10,
};

describe('snapPointMm — geometry beats the grid', () => {
  // The whole point of ranking them: a real corner at (100,100) must not be
  // dragged to a grid line, and here the grid line happens to be the same point,
  // so the test uses a corner that is deliberately OFF the grid.
  const offGrid: Sketch = {
    entities: [
      {
        kind: 'rect',
        id: 'r',
        origin: { x: 103, y: 107 },
        widthMm: 60,
        heightMm: 40,
        cornerRadiusMm: 0,
      },
    ],
  };

  it('captures an off-grid corner rather than rounding it to the grid', () => {
    const result = snapPointMm({ ...base, sketch: offGrid, rawMm: { x: 104, y: 108 } });
    expect(result.target?.kind).toBe('endpoint');
    expect(result.pointMm).toEqual({ x: 103, y: 107 });
  });

  it('falls back to the grid when no geometry is in reach', () => {
    const result = snapPointMm({ ...base, rawMm: { x: 312, y: 288 } });
    expect(result.target).toBeNull();
    expect(result.pointMm).toEqual({ x: 310, y: 290 });
  });

  it('leaves the point alone entirely when snapping is off', () => {
    const raw = { x: 104.37, y: 108.91 };
    const result = snapPointMm({ ...base, snapEnabled: false, rawMm: raw });
    expect(result.pointMm).toBe(raw);
    expect(result.target).toBeNull();
  });

  it('reports which kind captured the point', () => {
    const midpoint = snapPointMm({ ...base, rawMm: { x: 130, y: 100.4 } });
    expect(midpoint.target?.kind).toBe('midpoint');
    const centre = snapPointMm({ ...base, rawMm: { x: 130.3, y: 120.3 } });
    expect(centre.target?.kind).toBe('center');
  });

  it('scales its reach with the zoom, since the radius is in screen pixels', () => {
    // 10 px of reach is 5 mm at 2 px/mm but only 0.5 mm at 20 px/mm. The probe sits
    // OUTSIDE the rectangle, diagonally off the corner, so no edge lies under it —
    // otherwise the point-on-line snap would catch it at distance zero at any zoom.
    const near = { x: 98, y: 98 };
    expect(snapPointMm({ ...base, rawMm: near }).target?.kind).toBe('endpoint');
    expect(snapPointMm({ ...base, pxPerMm: 20, rawMm: near }).target).toBeNull();
  });

  it('survives a degenerate zoom without dividing by zero', () => {
    const result = snapPointMm({ ...base, pxPerMm: 0, rawMm: { x: 100, y: 100 } });
    expect(Number.isFinite(result.pointMm.x)).toBe(true);
    expect(Number.isFinite(result.pointMm.y)).toBe(true);
  });
});

describe('snapToGridMm', () => {
  it('rounds to the nearest intersection', () => {
    expect(snapToGridMm({ x: 12.4, y: 27.6 }, { enabled: true, gridMm: 10 })).toEqual({
      x: 10,
      y: 30,
    });
  });

  it('passes the point through when disabled', () => {
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

describe('snapKindLabel', () => {
  it('names every kind for the status bar', () => {
    expect(snapKindLabel('endpoint')).toBe('node');
    expect(snapKindLabel('midpoint')).toBe('midpoint');
    expect(snapKindLabel('center')).toBe('centre');
    expect(snapKindLabel('quadrant')).toBe('quadrant');
    expect(snapKindLabel('intersection')).toBe('intersection');
    expect(snapKindLabel('on-line')).toBe('edge');
  });
});
