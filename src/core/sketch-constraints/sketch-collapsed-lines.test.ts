import { describe, expect, it } from 'vitest';
import type { ConstrainedSketch2d } from './constrained-sketch';
import { solveConstrainedSketch } from './solve-constrained-sketch';
import { sketchCollapsedLines } from './sketch-collapsed-lines';

// Oracle audit O10-P3-1: a rectangle whose bottom line is marked vertical by
// mistake solves "fully constrained" into a triangle with a zero-length edge.
// The solve is right; the review must say which line vanished.
function rectangleWithBottomMarkedVertical(): ConstrainedSketch2d {
  return {
    version: 1,
    name: 'Mistaken rectangle',
    parameters: [],
    points: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 60, y: 0 },
      { id: 'c', x: 60, y: 30 },
      { id: 'd', x: 0, y: 30 },
    ],
    lines: [
      { id: 'bottom', first: 'a', second: 'b' },
      { id: 'right', first: 'b', second: 'c' },
      { id: 'top', first: 'c', second: 'd' },
      { id: 'left', first: 'd', second: 'a' },
    ],
    circles: [],
    profiles: [{ id: 'outline', pointIds: ['a', 'b', 'c', 'd'], closed: true }],
    constraints: [
      { id: 'a-x', kind: 'x', pointId: 'a', value: 0 },
      { id: 'a-y', kind: 'y', pointId: 'a', value: 0 },
      { id: 'bottom-horizontal', kind: 'horizontal', lineId: 'bottom' },
      { id: 'bottom-vertical', kind: 'vertical', lineId: 'bottom' },
      { id: 'top-horizontal', kind: 'horizontal', lineId: 'top' },
      { id: 'left-vertical', kind: 'vertical', lineId: 'left' },
      { id: 'left-length', kind: 'distance', first: 'd', second: 'a', value: 30 },
      { id: 'diagonal', kind: 'distance', first: 'a', second: 'c', value: Math.hypot(60, 30) },
    ],
  };
}

describe('sketchCollapsedLines', () => {
  it('names a line that a solve shrank to no length', () => {
    const result = solveConstrainedSketch(rectangleWithBottomMarkedVertical());
    expect(result.kind).toBe('solved');
    if (result.kind !== 'solved') return;
    expect(result.status).toBe('fully-constrained');
    expect(sketchCollapsedLines(result.sketch)).toEqual(['bottom']);
  });

  it('names nothing for an ordinary rectangle', () => {
    const sketch = rectangleWithBottomMarkedVertical();
    const fixed = {
      ...sketch,
      constraints: sketch.constraints.map((constraint) =>
        constraint.id === 'bottom-vertical'
          ? { id: 'right-vertical', kind: 'vertical' as const, lineId: 'right' }
          : constraint,
      ),
    };
    const result = solveConstrainedSketch(fixed);
    expect(result.kind === 'solved' && sketchCollapsedLines(result.sketch)).toEqual([]);
  });

  it('names a line drawn from a point to itself', () => {
    const sketch: ConstrainedSketch2d = {
      ...rectangleWithBottomMarkedVertical(),
      lines: [{ id: 'dot', first: 'a', second: 'a' }],
      profiles: [],
      constraints: [],
    };
    expect(sketchCollapsedLines(sketch)).toEqual(['dot']);
  });
});
