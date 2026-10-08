import { describe, expect, it } from 'vitest';
import type { ConstrainedSketch2d } from './constrained-sketch';
import { materializeConstrainedSketch } from './materialize-constrained-sketch';
import { sketchPathKeys } from './sketch-path-geometry';

function rectangle(closed: boolean): ConstrainedSketch2d {
  return {
    version: 1,
    name: 'Profile with authored lines',
    parameters: [],
    points: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 20, y: 0 },
      { id: 'c', x: 20, y: 10 },
      { id: 'd', x: 0, y: 10 },
    ],
    lines: [
      { id: 'edge', first: 'b', second: 'a' },
      { id: 'diagonal', first: 'a', second: 'c' },
      { id: 'closing', first: 'd', second: 'a' },
    ],
    circles: [],
    profiles: [{ id: 'outline', pointIds: ['a', 'b', 'c', 'd'], closed }],
    constraints: [],
  };
}

describe('profile edges and independent sketch lines', () => {
  it('materializes a diagonal between nonadjacent profile vertices', () => {
    const sketch = rectangle(true);
    const built = materializeConstrainedSketch(sketch, '#000000');
    expect(sketchPathKeys(sketch)).toEqual(['profile-outline', 'line-diagonal']);
    expect(built.paths).toHaveLength(2);
    expect(built.paths?.[1]?.polylines).toEqual([
      {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
        ],
      },
    ]);
  });

  it('retains the authored closing line of an open profile', () => {
    const sketch = rectangle(false);
    const built = materializeConstrainedSketch(sketch, '#000000');
    expect(sketchPathKeys(sketch)).toEqual(['profile-outline', 'line-diagonal', 'line-closing']);
    expect(built.paths?.[2]?.polylines).toEqual([
      {
        closed: false,
        points: [
          { x: 0, y: 10 },
          { x: 0, y: 0 },
        ],
      },
    ]);
  });
});
