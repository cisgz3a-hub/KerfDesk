import { describe, expect, it } from 'vitest';
import { contourBox, visitContourBoxPairsSteps, type ContourBox } from './contour-spatial';
import { runTraceSteps } from './trace-steps';

type Box = ContourBox & { readonly id: number };

function referencePairs(boxes: ReadonlyArray<Box>): number[][] {
  const extent = contourBox(
    boxes.flatMap((b) => [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.maxY },
    ]),
  );
  const horizontal = extent.maxX - extent.minX >= extent.maxY - extent.minY;
  const low = horizontal ? 'minX' : 'minY';
  const high = horizontal ? 'maxX' : 'maxY';
  const sorted = [...boxes].sort((a, b) => a[low] - b[low]);
  const result: number[][] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j]!;
      if (b[low] > a[high]) break;
      if (a.maxX >= b.minX && b.maxX >= a.minX && a.maxY >= b.minY && b.maxY >= a.minY) {
        result.push([a.id, b.id]);
      }
    }
  }
  return result;
}

function pairs(boxes: ReadonlyArray<Box>, cooperative = false): number[][] {
  const result: number[][] = [];
  const steps = visitContourBoxPairsSteps(boxes, (a, b) => result.push([a.id, b.id]));
  if (!cooperative) runTraceSteps(steps);
  else
    while (!steps.next(true).done) {
      /* drain checkpoints */
    }
  return result;
}

describe('contour box pair traversal', () => {
  it('keeps sweep order for nested, touching, degenerate and tied boxes on either axis', () => {
    const boxes = [
      [-4, -3, 5, 6],
      [-4, -3, 5, 6],
      [-4, -3, -4, -3],
      [5, 2, 5, 2],
      [5 + 1e-12, 2, 6, 3],
      [-0.25, -0.5, 0.125, 0.25],
      [-0.25, 0.25, 0.125, 0.5],
      [0, 0, 0, 0],
      [-100, 4, -99, 5],
    ].map(([minX, minY, maxX, maxY], id) => ({
      minX: minX!,
      minY: minY!,
      maxX: maxX!,
      maxY: maxY!,
      id,
    }));
    for (const input of [
      boxes,
      boxes.map((b) => ({ ...b, minX: b.minY, minY: b.minX, maxX: b.maxY, maxY: b.maxX })),
    ]) {
      expect(pairs(input)).toEqual(referencePairs(input));
      expect(pairs(input, true)).toEqual(referencePairs(input));
    }
  });

  it('retains input occurrences, including repeated object references', () => {
    const box = { minX: 0, minY: 0, maxX: 1, maxY: 1, id: 0 };
    expect(pairs([box, box, box])).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
  });

  it('does not scan every pair of distant elongated contours', () => {
    let boundsReads = 0;
    const boxes: Box[] = Array.from({ length: 5000 }, (_, id) => ({
      minX: 0,
      minY: id * 3,
      maxY: id * 3 + 1,
      id,
      get maxX() {
        boundsReads += 1;
        return 30000;
      },
    }));
    expect(pairs(boxes)).toEqual([]);
    expect(boundsReads).toBeLessThan(500000);
  });

  it('retains legacy pair behavior for nonfinite or inverted boxes', () => {
    const boxes: Box[] = [
      { minX: 0, minY: 0, maxX: 1, maxY: 1, id: 0 },
      { minX: -Infinity, minY: 0, maxX: Infinity, maxY: 1, id: 1 },
      { minX: NaN, minY: 0, maxX: NaN, maxY: 1, id: 2 },
      { minX: 1, minY: 0, maxX: -1, maxY: 1, id: 3 },
    ];
    expect(pairs(boxes)).toEqual(referencePairs(boxes));
  });
});
