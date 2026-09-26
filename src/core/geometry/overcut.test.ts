import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { overcutClosedPolyline } from './overcut';

const SQUARE: ReadonlyArray<Vec2> = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
  { x: 0, y: 0 },
];

describe('overcutClosedPolyline', () => {
  it('runs on past the start along the first edge', () => {
    expect(overcutClosedPolyline(SQUARE, 3)).toEqual([...SQUARE, { x: 3, y: 0 }]);
  });

  it('follows the contour round corners', () => {
    expect(overcutClosedPolyline(SQUARE, 12)).toEqual([
      ...SQUARE,
      { x: 10, y: 0 },
      { x: 10, y: 2 },
    ]);
  });

  it('goes round at most once more', () => {
    expect(overcutClosedPolyline(SQUARE, 500)).toEqual([...SQUARE, ...SQUARE.slice(1)]);
  });

  it('leaves open or unclosed paths and zero overcut unchanged', () => {
    const open = SQUARE.slice(0, 4);
    expect(overcutClosedPolyline(open, 3)).toBe(open);
    expect(overcutClosedPolyline(SQUARE, 0)).toBe(SQUARE);
    expect(overcutClosedPolyline(SQUARE, Number.NaN)).toBe(SQUARE);
  });
});
