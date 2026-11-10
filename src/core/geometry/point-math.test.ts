import { describe, expect, it } from 'vitest';
import {
  addPoints,
  cross,
  crossAbout,
  distance,
  dot,
  isFinitePoint,
  lerpPoint,
  midpoint,
  negatePoint,
  polylineLength,
  samePoint,
  scalePoint,
  subtractPoints,
  vectorLength,
} from './point-math';

const a = { x: 1, y: 2 };
const b = { x: 4, y: 6 };

describe('point-math', () => {
  it('measures distance the same in both directions', () => {
    expect(distance(a, b)).toBe(5);
    expect(distance(b, a)).toBe(5);
    expect(vectorLength({ x: 3, y: -4 })).toBe(5);
  });

  it('compares points exactly, with no tolerance', () => {
    expect(samePoint(a, { x: 1, y: 2 })).toBe(true);
    expect(samePoint(a, { x: 1 + 1e-12, y: 2 })).toBe(false);
  });

  it('rejects NaN and infinite coordinates', () => {
    expect(isFinitePoint(a)).toBe(true);
    expect(isFinitePoint({ x: Number.NaN, y: 0 })).toBe(false);
    expect(isFinitePoint({ x: 0, y: Infinity })).toBe(false);
  });

  it('interpolates from the first point to the second', () => {
    expect(lerpPoint(a, b, 0)).toEqual(a);
    expect(lerpPoint(a, b, 1)).toEqual(b);
    expect(lerpPoint(a, b, 0.5)).toEqual(midpoint(a, b));
    expect(midpoint(a, b)).toEqual({ x: 2.5, y: 4 });
  });

  it('adds, subtracts, scales and negates', () => {
    expect(addPoints(a, b)).toEqual({ x: 5, y: 8 });
    expect(subtractPoints(b, a)).toEqual({ x: 3, y: 4 });
    expect(scalePoint(a, 3)).toEqual({ x: 3, y: 6 });
    expect(negatePoint(a)).toEqual({ x: -1, y: -2 });
  });

  it('gives dot and cross products their usual signs', () => {
    expect(dot(a, b)).toBe(16);
    // With Y up, +Y is counter-clockwise of +X.
    expect(cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1);
    expect(crossAbout({ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 6 })).toBe(1);
    expect(crossAbout({ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 5 })).toBe(-1);
  });

  it('sums the segments of an open polyline', () => {
    expect(polylineLength([])).toBe(0);
    expect(polylineLength([a])).toBe(0);
    expect(polylineLength([a, b, { x: 4, y: 0 }])).toBe(11);
  });
});
