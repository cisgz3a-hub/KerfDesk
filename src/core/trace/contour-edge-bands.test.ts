import { describe, expect, it } from 'vitest';
import { unionContourBoxes, type ContourBox } from './contour-bounds';
import { contourEdgeBandsSteps } from './contour-edge-bands';
import { runTraceSteps } from './trace-steps';

type Tagged = ContourBox & { readonly id: number };

function overlapping(boxes: ReadonlyArray<Tagged>, box: ContourBox): number[] {
  return boxes
    .filter(
      (b) => b.maxX >= box.minX && box.maxX >= b.minX && b.maxY >= box.minY && box.maxY >= b.minY,
    )
    .map((b) => b.id)
    .sort((a, b) => a - b);
}

function segmentBox(id: number, ax: number, ay: number, bx: number, by: number): Tagged {
  return {
    id,
    minX: Math.min(ax, bx),
    minY: Math.min(ay, by),
    maxX: Math.max(ax, bx),
    maxY: Math.max(ay, by),
  };
}

describe('contour edge bands', () => {
  it('finds exactly the boxes a brute-force inclusive overlap test finds', () => {
    let seed = 11;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    // A wandering closed chain plus a long horizontal run in both directions
    // (one band holding many edges) and exactly touching boxes.
    const boxes: Tagged[] = [];
    let x = 50;
    let y = 50;
    for (let i = 0; i < 400; i += 1) {
      const nx = x + (random() - 0.5) * 3;
      const ny = y + (random() - 0.5) * 3;
      boxes.push(segmentBox(boxes.length, x, y, nx, ny));
      [x, y] = [nx, ny];
    }
    for (let i = 0; i < 60; i += 1) boxes.push(segmentBox(boxes.length, i, 10, i + 1, 10));
    for (let i = 60; i > 0; i -= 1) boxes.push(segmentBox(boxes.length, i, 10.5, i - 1, 10.5));
    boxes.push(segmentBox(boxes.length, 0.1, 0.1, 0.3, 0.3));
    const index = runTraceSteps(contourEdgeBandsSteps(boxes, unionContourBoxes(boxes)));
    const queries: ContourBox[] = [
      ...boxes,
      { minX: 0.3, minY: 0.3, maxX: 0.3, maxY: 0.3 },
      { minX: -5, minY: -5, maxX: 200, maxY: 200 },
      { minX: 30, minY: 10, maxX: 30, maxY: 10 },
    ];
    for (const query of queries) {
      const found = index
        .query(query)
        .map((b) => b.id)
        .sort((a, b) => a - b);
      expect(found).toEqual(overlapping(boxes, query));
    }
  });

  it('answers when every edge is horizontal or the boundary has no height', () => {
    const boxes = [segmentBox(0, 0, 4, 3, 4), segmentBox(1, 3, 4, 6, 4), segmentBox(2, 6, 4, 9, 4)];
    const index = runTraceSteps(contourEdgeBandsSteps(boxes, unionContourBoxes(boxes)));
    expect(
      index
        .query({ minX: 3, minY: 4, maxX: 3, maxY: 4 })
        .map((b) => b.id)
        .sort(),
    ).toEqual([0, 1]);
    expect(index.query({ minX: 9.5, minY: 4, maxX: 10, maxY: 4 })).toEqual([]);
  });

  it('offers checkpoints to a cooperative runner', () => {
    const boxes = Array.from({ length: 1000 }, (_, i) =>
      segmentBox(i, i, i % 7, i + 1, (i + 1) % 7),
    );
    const steps = contourEdgeBandsSteps(boxes, unionContourBoxes(boxes));
    let checkpoints = 0;
    for (;;) {
      const step = steps.next(true);
      if (step.done) break;
      checkpoints += 1;
    }
    expect(checkpoints).toBeGreaterThan(10);
  });
});
