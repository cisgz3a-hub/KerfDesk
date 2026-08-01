import { describe, expect, it } from 'vitest';

import { handleAtPoint, resizeFactor, resizeHandles } from './design-handles';

const bounds = { minX: 10, minY: 20, maxX: 110, maxY: 80 };

describe('resizeHandles', () => {
  it('puts a grip on each corner, anchored to the opposite one', () => {
    const handles = resizeHandles(bounds);
    expect(handles.map((handle) => handle.corner)).toEqual(['sw', 'se', 'nw', 'ne']);
    const sw = handles.find((handle) => handle.corner === 'sw');
    expect(sw?.atMm).toEqual({ x: 10, y: 20 });
    expect(sw?.anchorMm).toEqual({ x: 110, y: 80 });
    const ne = handles.find((handle) => handle.corner === 'ne');
    expect(ne?.atMm).toEqual({ x: 110, y: 80 });
    expect(ne?.anchorMm).toEqual({ x: 10, y: 20 });
  });

  it('offers no grips without bounds or extent', () => {
    expect(resizeHandles(null)).toHaveLength(0);
    expect(resizeHandles({ minX: 5, minY: 5, maxX: 5, maxY: 5 })).toHaveLength(0);
  });

  it('still grips a zero-height selection, which has a width to scale', () => {
    expect(resizeHandles({ minX: 0, minY: 5, maxX: 40, maxY: 5 })).toHaveLength(4);
  });
});

describe('handleAtPoint', () => {
  const handles = resizeHandles(bounds);

  it('picks the grip under the pointer and ignores far ones', () => {
    expect(handleAtPoint(handles, { x: 11, y: 21 }, 3)?.corner).toBe('sw');
    expect(handleAtPoint(handles, { x: 60, y: 50 }, 3)).toBeNull();
  });

  it('picks the nearest when two are in reach', () => {
    // Midway along the bottom edge, nudged toward the south-east corner.
    expect(handleAtPoint(handles, { x: 100, y: 20 }, 200)?.corner).toBe('se');
  });
});

describe('resizeFactor', () => {
  const sw = resizeHandles(bounds).find((handle) => handle.corner === 'sw');

  it('is 1 when the grip has not moved', () => {
    expect(sw === undefined ? null : resizeFactor(sw, sw.atMm)).toBeCloseTo(1, 6);
  });

  it('doubles when the grip is dragged to twice the span from its anchor', () => {
    if (sw === undefined) throw new Error('expected a grip');
    // Anchor is (110, 80); the grip starts at (10, 20). Twice that offset.
    const twice = { x: 110 - 200, y: 80 - 120 };
    expect(resizeFactor(sw, twice)).toBeCloseTo(2, 6);
  });

  it('halves when dragged to half the span', () => {
    if (sw === undefined) throw new Error('expected a grip');
    const half = { x: 110 - 50, y: 80 - 30 };
    expect(resizeFactor(sw, half)).toBeCloseTo(0.5, 6);
  });
});
