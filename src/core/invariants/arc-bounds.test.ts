import { describe, expect, it } from 'vitest';
import { arcAabb } from './arc-bounds';

const P = (x: number, y: number) => ({ x, y });

describe('arcAabb', () => {
  it('a first-quadrant quarter arc stays within its endpoints box (no cardinal swept)', () => {
    // CCW (G3) from (1,0) to (0,1), centre (0,0): bulges toward (0.7,0.7), inside.
    const box = arcAabb(P(1, 0), P(0, 1), -1, 0, false);
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  });

  it('a CCW half-circle bulges up through +Y', () => {
    // G3 from (1,0) to (-1,0), centre (0,0): passes the top (0,1).
    const box = arcAabb(P(1, 0), P(-1, 0), -1, 0, false);
    expect(box.maxY).toBeCloseTo(1, 9);
    expect(box.minY).toBeCloseTo(0, 9); // endpoints on y=0, never dips below
    expect(box.minX).toBeCloseTo(-1, 9);
    expect(box.maxX).toBeCloseTo(1, 9);
  });

  it('a CW half-circle over the same endpoints bulges down through -Y', () => {
    // G2 from (1,0) to (-1,0): the clockwise path passes the bottom (0,-1).
    const box = arcAabb(P(1, 0), P(-1, 0), -1, 0, true);
    expect(box.minY).toBeCloseTo(-1, 9);
    expect(box.maxY).toBeCloseTo(0, 9);
  });

  it('a G2 arc from (0,0) to (10,0) about centre (5,0) peaks at +Y 5', () => {
    // Clockwise from the 9-o’clock point up over the top to 3-o’clock.
    const box = arcAabb(P(0, 0), P(10, 0), 5, 0, true);
    expect(box.maxY).toBeCloseTo(5, 9);
    expect(box.minX).toBeCloseTo(0, 9);
    expect(box.maxX).toBeCloseTo(10, 9);
  });

  it('a full circle (start == end) spans centre ± r on every axis', () => {
    const box = arcAabb(P(1, 0), P(1, 0), -1, 0, false);
    expect(box.minX).toBeCloseTo(-1, 9);
    expect(box.maxX).toBeCloseTo(1, 9);
    expect(box.minY).toBeCloseTo(-1, 9);
    expect(box.maxY).toBeCloseTo(1, 9);
  });
});
