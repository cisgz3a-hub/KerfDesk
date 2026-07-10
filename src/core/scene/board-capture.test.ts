import { describe, expect, it } from 'vitest';
import {
  BOARD_CORNER_COUNT,
  bestFitRectangleFromCorners,
  boardCornersFromOrigin,
  boardMachinePoints,
  diameterFromCenterEdge,
  firstCornerOffsetMm,
} from './board-capture';
import type { Vec2 } from './scene-object';

// A horizontal 300 × 200 board, bottom-left at machine (0,0). Named corners so
// the tests can feed them in any capture order.
const BL: Vec2 = { x: 0, y: 0 };
const BR: Vec2 = { x: 300, y: 0 };
const TR: Vec2 = { x: 300, y: 200 };
const TL: Vec2 = { x: 0, y: 200 };

describe('bestFitRectangleFromCorners', () => {
  it('derives width and height from the bounding box (X extent × Y extent)', () => {
    const rect = bestFitRectangleFromCorners([BL, BR, TR, TL]);
    expect(rect?.widthMm).toBeCloseTo(300, 6);
    expect(rect?.heightMm).toBeCloseTo(200, 6);
    expect(rect?.offSquareMm).toBeCloseTo(0, 6);
  });

  it('is independent of capture order — the bug where up-the-left-side swapped W/H', () => {
    // The operator captured BL → TL → TR → BR (up the left, across the top, down
    // the right). The old edge-averaging swapped this to 200 × 300 (vertical);
    // the bounding box gives the true 300 × 200 (horizontal) regardless.
    const upLeftFirst = bestFitRectangleFromCorners([BL, TL, TR, BR]);
    expect(upLeftFirst?.widthMm).toBeCloseTo(300, 6);
    expect(upLeftFirst?.heightMm).toBeCloseTo(200, 6);
  });

  it('gives the same rectangle for every perimeter order and direction', () => {
    const orders: ReadonlyArray<ReadonlyArray<Vec2>> = [
      [BL, BR, TR, TL], // CCW from BL
      [BL, TL, TR, BR], // CW from BL (the operator's order)
      [TR, BR, BL, TL], // starting elsewhere
      [TL, BL, BR, TR],
    ];
    for (const order of orders) {
      const rect = bestFitRectangleFromCorners(order);
      expect(rect?.widthMm).toBeCloseTo(300, 6);
      expect(rect?.heightMm).toBeCloseTo(200, 6);
      expect(rect?.offSquareMm).toBeCloseTo(0, 6);
    }
  });

  it('flags a board rotated on the bed (corners off the bounding-box corners)', () => {
    const rad = Math.PI / 12; // 15°
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rotate = (p: Vec2): Vec2 => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
    const rect = bestFitRectangleFromCorners([BL, BR, TR, TL].map(rotate));
    // Rotated corners no longer touch the bounding-box corners → large deviation.
    expect(rect?.offSquareMm ?? 0).toBeGreaterThan(20);
  });

  it('flags a sheared/mis-captured quad', () => {
    // One corner pulled inward — not a rectangle.
    const rect = bestFitRectangleFromCorners([BL, BR, { x: 260, y: 200 }, TL]);
    expect(rect?.offSquareMm ?? 0).toBeGreaterThan(20);
  });

  it('flags a capture that skips a corner and repeats another', () => {
    // BL, BR, TR, BR — top-left never visited, bottom-right captured twice. The
    // bounding box is still 300×200, but the top-left box corner has no captured
    // point near it → large gap. (The old point→nearest-corner metric scored
    // this exactly 0 and passed a board that never visited all four corners.)
    const rect = bestFitRectangleFromCorners([BL, BR, TR, BR]);
    expect(rect?.widthMm).toBeCloseTo(300, 6);
    expect(rect?.offSquareMm ?? 0).toBeGreaterThan(100);
  });

  it('returns null for a non-finite coordinate', () => {
    expect(bestFitRectangleFromCorners([BL, BR, TR, { x: Number.NaN, y: 200 }])).toBeNull();
    expect(boardMachinePoints([BL, BR, TR, { x: 0, y: Number.POSITIVE_INFINITY }])).toBeNull();
  });

  it('reports zero height for a collinear capture (the UI blocks it as too small)', () => {
    const rect = bestFitRectangleFromCorners([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    ]);
    expect(rect?.heightMm).toBe(0);
  });

  it('returns null unless exactly four corners are given', () => {
    expect(bestFitRectangleFromCorners([])).toBeNull();
    expect(bestFitRectangleFromCorners([BL, BR, TR])).toBeNull();
    expect(bestFitRectangleFromCorners([BL, BR, TR, TL, BL])).toBeNull();
  });
});

describe('boardCornersFromOrigin', () => {
  it('synthesizes a perfect axis-aligned board from the bottom-left origin + size', () => {
    const corners = boardCornersFromOrigin({ x: 200, y: 150 }, 120, 80);
    // BL, BR, TR, TL from the origin.
    expect(corners).toEqual([
      { x: 200, y: 150 },
      { x: 320, y: 150 },
      { x: 320, y: 230 },
      { x: 200, y: 230 },
    ]);
    // Feeds the same pipeline: exact size, zero off-square (a clean rectangle).
    const rect = bestFitRectangleFromCorners(corners);
    expect(rect?.widthMm).toBeCloseTo(120, 6);
    expect(rect?.heightMm).toBeCloseTo(80, 6);
    expect(rect?.offSquareMm).toBeCloseTo(0, 6);
  });
});

describe('boardMachinePoints', () => {
  it('maps anchors to the bounding-box corners and centre, order-independently', () => {
    // Captured up-the-left-side; anchors must still map to the right physical
    // corners (not the capture indices).
    const points = boardMachinePoints([BL, TL, TR, BR]);
    expect(points?.['bottom-left']).toEqual({ x: 0, y: 0 });
    expect(points?.['bottom-right']).toEqual({ x: 300, y: 0 });
    expect(points?.['top-right']).toEqual({ x: 300, y: 200 });
    expect(points?.['top-left']).toEqual({ x: 0, y: 200 });
    expect(points?.center).toEqual({ x: 150, y: 100 });
  });

  it('returns null for the wrong number of corners', () => {
    expect(boardMachinePoints([BL, BR])).toBeNull();
  });
});

describe('BOARD_CORNER_COUNT', () => {
  it('is four', () => {
    expect(BOARD_CORNER_COUNT).toBe(4);
  });
});

describe('diameterFromCenterEdge', () => {
  it('doubles the axis-aligned centre-to-edge distance', () => {
    expect(diameterFromCenterEdge({ x: 100, y: 100 }, { x: 140, y: 100 })).toBeCloseTo(80, 6);
  });

  it('measures a diagonal rim point (3-4-5 → radius 5)', () => {
    expect(diameterFromCenterEdge({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(10, 6);
  });

  it('is direction-independent (edge below the centre)', () => {
    expect(diameterFromCenterEdge({ x: 100, y: 100 }, { x: 100, y: 60 })).toBeCloseTo(80, 6);
  });

  it('is zero when the edge sits on the centre (a double-click)', () => {
    expect(diameterFromCenterEdge({ x: 50, y: 50 }, { x: 50, y: 50 })).toBe(0);
  });

  it('returns zero for non-finite input instead of NaN', () => {
    expect(diameterFromCenterEdge({ x: Number.NaN, y: 0 }, { x: 10, y: 0 })).toBe(0);
    expect(diameterFromCenterEdge({ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 0 })).toBe(0);
  });
});

describe('firstCornerOffsetMm (wrong-first-corner plausibility — CAM-05)', () => {
  it('is ~0 when the first captured corner IS the bottom-left', () => {
    expect(firstCornerOffsetMm([BL, BR, TR, TL])).toBeCloseTo(0, 9);
  });

  it('is the board diagonal when the top-right was captured first', () => {
    // TR = (300,200); distance to bounding-box (0,0) = hypot(300,200) ≈ 360.55.
    expect(firstCornerOffsetMm([TR, BR, BL, TL])).toBeCloseTo(Math.hypot(300, 200), 6);
  });

  it('returns null for anything other than four finite corners', () => {
    expect(firstCornerOffsetMm([BL, BR, TR])).toBeNull();
    expect(firstCornerOffsetMm([BL, BR, TR, { x: Number.NaN, y: 0 }])).toBeNull();
  });
});
