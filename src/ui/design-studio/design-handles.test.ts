import { describe, expect, it } from 'vitest';

import { handleAtPoint, resizeFactors, resizeHandles } from './design-handles';

const bounds = { minX: 10, minY: 20, maxX: 110, maxY: 80 };

describe('resizeHandles', () => {
  it('puts a grip on each corner, anchored to the opposite one', () => {
    const handles = resizeHandles(bounds);
    const sw = handles.find((handle) => handle.id === 'sw');
    expect(sw?.atMm).toEqual({ x: 10, y: 20 });
    expect(sw?.anchorMm).toEqual({ x: 110, y: 80 });
    expect(sw?.axis).toBe('both');
    const ne = handles.find((handle) => handle.id === 'ne');
    expect(ne?.atMm).toEqual({ x: 110, y: 80 });
    expect(ne?.anchorMm).toEqual({ x: 10, y: 20 });
  });

  it('puts a grip on each edge midpoint, anchored to the opposite edge', () => {
    const handles = resizeHandles(bounds);
    expect(handles.map((handle) => handle.id)).toEqual([
      'sw',
      'se',
      'nw',
      'ne',
      'w',
      'e',
      's',
      'n',
    ]);
    const east = handles.find((handle) => handle.id === 'e');
    expect(east?.atMm).toEqual({ x: 110, y: 50 });
    expect(east?.anchorMm).toEqual({ x: 10, y: 50 });
    expect(east?.axis).toBe('x');
    const north = handles.find((handle) => handle.id === 'n');
    expect(north?.atMm).toEqual({ x: 60, y: 80 });
    expect(north?.anchorMm).toEqual({ x: 60, y: 20 });
    expect(north?.axis).toBe('y');
  });

  it('offers no grips without bounds or extent', () => {
    expect(resizeHandles(null)).toHaveLength(0);
    expect(resizeHandles({ minX: 5, minY: 5, maxX: 5, maxY: 5 })).toHaveLength(0);
  });

  // A horizontal line has a width to stretch but no height, so the vertical
  // grips would be a division by zero rather than a resize.
  it('drops only the grips whose own axis is flat', () => {
    const flat = resizeHandles({ minX: 0, minY: 5, maxX: 40, maxY: 5 });
    expect(flat.map((handle) => handle.id)).toEqual(['sw', 'se', 'nw', 'ne', 'w', 'e']);
  });
});

describe('handleAtPoint', () => {
  const handles = resizeHandles(bounds);

  it('picks the grip under the pointer and ignores far ones', () => {
    expect(handleAtPoint(handles, { x: 11, y: 21 }, 3)?.id).toBe('sw');
    expect(handleAtPoint(handles, { x: 60, y: 50 }, 3)).toBeNull();
  });

  it('picks the nearest when two are in reach', () => {
    // Midway along the bottom edge, nudged toward the south-east corner: the
    // corner is 10 away and the south edge grip 40, so the corner wins.
    expect(handleAtPoint(handles, { x: 100, y: 20 }, 200)?.id).toBe('se');
  });

  it('picks the edge grip on the edge it sits at', () => {
    expect(handleAtPoint(handles, { x: 110, y: 51 }, 3)?.id).toBe('e');
  });
});

describe('resizeFactors on a corner grip', () => {
  const sw = resizeHandles(bounds).find((handle) => handle.id === 'sw');

  it('is 1 on both axes when the grip has not moved', () => {
    if (sw === undefined) throw new Error('expected a grip');
    const factors = resizeFactors(sw, sw.atMm);
    expect(factors.x).toBeCloseTo(1, 6);
    expect(factors.y).toBeCloseTo(1, 6);
  });

  it('doubles both axes when dragged to twice the span from its anchor', () => {
    if (sw === undefined) throw new Error('expected a grip');
    // Anchor is (110, 80); the grip starts at (10, 20). Twice that offset.
    const twice = { x: 110 - 200, y: 80 - 120 };
    expect(resizeFactors(sw, twice).x).toBeCloseTo(2, 6);
    expect(resizeFactors(sw, twice).y).toBeCloseTo(2, 6);
  });

  it('halves when dragged to half the span', () => {
    if (sw === undefined) throw new Error('expected a grip');
    const half = { x: 110 - 50, y: 80 - 30 };
    expect(resizeFactors(sw, half).x).toBeCloseTo(0.5, 6);
  });
});

describe('resizeFactors on an edge grip', () => {
  const east = resizeHandles(bounds).find((handle) => handle.id === 'e');
  const north = resizeHandles(bounds).find((handle) => handle.id === 'n');

  // The whole point of an edge grip: the axis it does not own reads EXACTLY 1,
  // so the held dimension survives the drag untouched by rounding.
  it('changes only its own axis', () => {
    if (east === undefined) throw new Error('expected a grip');
    const factors = resizeFactors(east, { x: 210, y: 50 });
    expect(factors.x).toBeCloseTo(2, 6);
    expect(factors.y).toBe(1);
  });

  it('measures the vertical grip against the vertical span', () => {
    if (north === undefined) throw new Error('expected a grip');
    // Anchor y is 20 and the grip starts at 80, a span of 60; dragging to 110
    // asks for 90/60.
    const factors = resizeFactors(north, { x: 60, y: 110 });
    expect(factors.x).toBe(1);
    expect(factors.y).toBeCloseTo(1.5, 6);
  });

  // Sideways movement on a horizontal grip is not a stretch of anything.
  it('ignores movement across its axis', () => {
    if (east === undefined) throw new Error('expected a grip');
    expect(resizeFactors(east, { x: 210, y: -900 }).x).toBeCloseTo(2, 6);
  });
});
