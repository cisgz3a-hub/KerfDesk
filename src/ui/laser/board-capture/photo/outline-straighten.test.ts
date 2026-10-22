import { describe, expect, it } from 'vitest';
import { straightenOutlineRun } from './outline-straighten';

// A board whose top edge was clicked with two wobbly points between its corners.
const WOBBLY = [
  { x: 0, y: 0 },
  { x: 100, y: 3 },
  { x: 200, y: -2 },
  { x: 300, y: 0 },
  { x: 300, y: 200 },
  { x: 0, y: 200 },
];

describe('straightenOutlineRun', () => {
  it('moves the points between the two ends onto the straight edge', () => {
    const result = straightenOutlineRun(WOBBLY, 0, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.points[1]?.x).toBeCloseTo(100);
    expect(result.points[1]?.y).toBeCloseTo(0);
    expect(result.points[2]?.x).toBeCloseTo(200);
    expect(result.points[2]?.y).toBeCloseTo(0);
    // Every other point is untouched.
    expect(result.points[4]).toEqual(WOBBLY[4]);
    expect(result.points[5]).toEqual(WOBBLY[5]);
  });

  it('does not depend on the order the ends are picked in', () => {
    expect(straightenOutlineRun(WOBBLY, 3, 0)).toEqual(straightenOutlineRun(WOBBLY, 0, 3));
  });

  it('straightens across the closing edge of the outline', () => {
    const closing = [
      { x: 0, y: 100 },
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 100, y: 102 },
    ];
    const result = straightenOutlineRun(closing, 3, 0);
    expect(result.ok && result.points[4]?.y).toBeCloseTo(100);
  });

  it('refuses to reshape the board when the points are far off the line', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const result = straightenOutlineRun(square, 0, 2);
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/too far off/) });
  });

  it('needs two different ends with a point between them', () => {
    expect(straightenOutlineRun(WOBBLY, 2, 2).ok).toBe(false);
    expect(straightenOutlineRun(WOBBLY, 0, 1)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/at least one point between/),
    });
  });
});
