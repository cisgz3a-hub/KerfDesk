import { describe, expect, it } from 'vitest';
import { isNovelPose, meanCornerShiftPx } from './capture-novelty';

const GRID = Array.from({ length: 12 }, (_, i) => ({
  x: 100 + (i % 4) * 40,
  y: 80 + Math.floor(i / 4) * 40,
}));

function shifted(dx: number, dy: number): Array<{ x: number; y: number }> {
  return GRID.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

describe('meanCornerShiftPx', () => {
  it('measures the mean displacement', () => {
    expect(meanCornerShiftPx(GRID, shifted(30, 40))).toBeCloseTo(50, 6);
  });

  it('returns null on mismatched or empty inputs', () => {
    expect(meanCornerShiftPx([], [])).toBeNull();
    expect(meanCornerShiftPx(GRID, GRID.slice(1))).toBeNull();
  });
});

describe('isNovelPose', () => {
  it('accepts the first capture and clearly moved boards', () => {
    expect(isNovelPose(GRID, [], 640, 480)).toBe(true);
    // 8% of the 640x480 diagonal is 64px; a 100px move is clearly novel.
    expect(isNovelPose(shifted(100, 0), [GRID], 640, 480)).toBe(true);
  });

  it('rejects a near-identical pose', () => {
    expect(isNovelPose(shifted(3, 2), [GRID], 640, 480)).toBe(false);
  });

  it('rejects when ANY prior capture is too close', () => {
    expect(isNovelPose(shifted(100, 0), [GRID, shifted(98, 2)], 640, 480)).toBe(false);
  });
});
