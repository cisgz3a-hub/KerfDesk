import { describe, expect, it } from 'vitest';
import { BOARD_PLACEMENT_ANCHORS, planBoardPlacement } from './board-anchor-placement';
import { boxInsideBoardRegion, type BoardRegion } from './board-region';
import type { AABB } from './hit-test';

const ART: AABB = { minX: 0, minY: 0, maxX: 20, maxY: 10 };

const RECT: BoardRegion = { kind: 'rect', bounds: { minX: 100, minY: 100, maxX: 300, maxY: 200 } };
const DISC: BoardRegion = {
  kind: 'circle',
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  center: { x: 50, y: 50 },
  radius: 50,
};
// Triangle, apex at the top (canvas Y down), base along the bottom.
const TRIANGLE: BoardRegion = {
  kind: 'polygon',
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  points: [
    { x: 0, y: 100 },
    { x: 100, y: 100 },
    { x: 50, y: 0 },
  ],
};
// L-shaped board whose bounding-box centre lies outside the material.
const ELL: BoardRegion = {
  kind: 'polygon',
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  points: [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 70 },
    { x: 100, y: 70 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
};

function placed(plan: { dx: number; dy: number }, art = ART): AABB {
  return {
    minX: art.minX + plan.dx,
    maxX: art.maxX + plan.dx,
    minY: art.minY + plan.dy,
    maxY: art.maxY + plan.dy,
  };
}

describe('planBoardPlacement on a rectangle', () => {
  it('reads as a 3x3 alignment grid inset by the margin', () => {
    expect(placed(planBoardPlacement(ART, RECT, 'top-left', 5))).toEqual({
      minX: 105,
      maxX: 125,
      minY: 105,
      maxY: 115,
    });
    expect(placed(planBoardPlacement(ART, RECT, 'bottom-center', 5))).toEqual({
      minX: 190,
      maxX: 210,
      minY: 185,
      maxY: 195,
    });
    expect(placed(planBoardPlacement(ART, RECT, 'middle-right', 0))).toEqual({
      minX: 280,
      maxX: 300,
      minY: 145,
      maxY: 155,
    });
    expect(placed(planBoardPlacement(ART, RECT, 'center', 10))).toEqual({
      minX: 190,
      maxX: 210,
      minY: 145,
      maxY: 155,
    });
  });

  it('flags artwork wider than the board inside the margin', () => {
    const wide = { minX: 0, minY: 0, maxX: 199, maxY: 10 };
    expect(planBoardPlacement(wide, RECT, 'center', 0).fits).toBe(true);
    expect(planBoardPlacement(wide, RECT, 'center', 1).fits).toBe(false);
  });
});

describe('planBoardPlacement on a round board', () => {
  it('keeps every anchor inside the disc with the requested clearance', () => {
    for (const anchor of BOARD_PLACEMENT_ANCHORS) {
      const plan = planBoardPlacement(ART, DISC, anchor, 3);
      expect(plan.fits).toBe(true);
      expect(boxInsideBoardRegion(DISC, placed(plan), 3)).toBe(true);
    }
  });

  it('pushes bottom-middle down until the corners meet the rim clearance', () => {
    const box = placed(planBoardPlacement(ART, DISC, 'bottom-center', 0));
    expect((box.minX + box.maxX) / 2).toBeCloseTo(50, 6);
    // Bottom corners at (40|60, y) touch radius 50: y = 50 + sqrt(50² − 10²).
    expect(box.maxY).toBeCloseTo(50 + Math.sqrt(2500 - 100), 3);
  });

  it('tucks top-left into the upper-left of the disc', () => {
    const box = placed(planBoardPlacement(ART, DISC, 'top-left', 0));
    expect(box.minX).toBeLessThan(30);
    expect(box.minY).toBeLessThan(30);
    expect(Math.hypot(box.minX - 50, box.minY - 50)).toBeCloseTo(50, 3);
  });
});

describe('planBoardPlacement on a custom shape', () => {
  it('slides top-middle up the triangle until the slanted edges stop it', () => {
    const box = placed(planBoardPlacement(ART, TRIANGLE, 'top-center', 0));
    expect((box.minX + box.maxX) / 2).toBeCloseTo(50, 6);
    // The triangle is 20 mm wide where y = 20 (half-width = y / 2).
    expect(box.minY).toBeCloseTo(20, 3);
    expect(boxInsideBoardRegion(TRIANGLE, box, 0)).toBe(true);
  });

  it('settles bottom-left into the corner of the base', () => {
    const box = placed(planBoardPlacement(ART, TRIANGLE, 'bottom-left', 2));
    expect(box.maxY).toBeCloseTo(98, 3);
    expect(boxInsideBoardRegion(TRIANGLE, box, 2)).toBe(true);
    expect(
      boxInsideBoardRegion(TRIANGLE, { ...box, minX: box.minX - 1, maxX: box.maxX - 1 }, 2),
    ).toBe(false);
  });

  it('centres on the material when the bounding-box centre is a notch', () => {
    const plan = planBoardPlacement(ART, ELL, 'center', 1);
    expect(plan.fits).toBe(true);
    expect(boxInsideBoardRegion(ELL, placed(plan), 1)).toBe(true);
  });

  it('never jumps across a notch to reach an anchor', () => {
    const plan = planBoardPlacement({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, ELL, 'top-right', 0);
    expect(
      boxInsideBoardRegion(ELL, placed(plan, { minX: 0, minY: 0, maxX: 10, maxY: 10 }), 0),
    ).toBe(true);
  });

  it('reports artwork larger than the board', () => {
    const huge = { minX: 0, minY: 0, maxX: 120, maxY: 120 };
    expect(planBoardPlacement(huge, TRIANGLE, 'center', 0).fits).toBe(false);
  });
});
