import { describe, expect, it } from 'vitest';
import { sizeTile } from './job-review-stat-tiles';

// UX audit U4-P3-7: "ORIGIN Absolute · Machine space" sat beside a job size in
// G-code coordinates and out-of-bed lines in bed coordinates, unlabelled.
describe('sizeTile', () => {
  it('names the range as the G-code coordinates', () => {
    const bounds = { minX: -40, minY: -150, maxX: 30, maxY: -90 };
    expect(sizeTile(bounds, bounds).detail).toBe('G-code X -40 to 30 · Y -150 to -90 mm');
  });
});
