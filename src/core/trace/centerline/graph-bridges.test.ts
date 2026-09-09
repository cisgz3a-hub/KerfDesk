import { describe, expect, it } from 'vitest';
import { bridgeChains } from './graph-bridges';
import { segmentInsideInk } from './junction-support';
import type { StrokeGraph } from './stroke-graph';

function graph(edges: ReadonlyArray<readonly [number, number]>): StrokeGraph {
  return { nodes: [], chains: edges.map(([a, b]) => ({ a, b, points: [], closed: false })) };
}

describe('cycle-preserving contraction candidates', () => {
  it('keeps a ring and a parallel return route while allowing an attached tree edge', () => {
    const g = graph([
      [0, 1],
      [1, 2],
      [2, 0],
      [2, 3],
      [3, 4],
      [3, 4],
      [4, 4],
    ]);
    expect([...bridgeChains(g)]).toEqual([3]);
  });

  it('walks a long open network without recursive stack growth', () => {
    const edges = Array.from({ length: 20000 }, (_, i) => [i, i + 1] as const);
    expect(bridgeChains(graph(edges)).size).toBe(edges.length);
  });
});

describe('new junction segment support', () => {
  it('rejects a white pixel crossed for less than a quarter pixel of arc length', () => {
    // From the lower-left to upper-right, the segment just clips cell (1,1).
    const distances = new Float64Array([1, 1, 1, 0]);
    expect(segmentInsideInk({ x: 0.2, y: 1.9 }, { x: 1.9, y: 0.2 }, distances, 2)).toBe(false);
    expect(segmentInsideInk({ x: 0.2, y: 1.8 }, { x: 1.8, y: 0.2 }, distances, 2)).toBe(true);
  });

  it('allows the same route when all crossed pixels contain ink', () => {
    expect(
      segmentInsideInk({ x: 0.2, y: 1.9 }, { x: 1.9, y: 0.2 }, new Float64Array(4).fill(1), 2),
    ).toBe(true);
  });
});
