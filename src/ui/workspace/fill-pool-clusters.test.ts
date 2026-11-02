// R5-P3-1: which artwork lies over a cluster, between its members, is found by one
// sweep. It has to answer exactly what scanning every gap answers.
import { describe, expect, it } from 'vitest';
import type { AABB } from '../../core/scene';
import { drawnOverClusters, type DrawnCluster } from './fill-pool-clusters';

function bruteForce(
  clusters: ReadonlyArray<DrawnCluster>,
  boxAt: (index: number) => AABB | null,
): number[][] {
  return clusters.map(({ indexes, box }) => {
    const found: number[] = [];
    for (let i = 1; i < indexes.length; i += 1) {
      for (let index = (indexes[i - 1] as number) + 1; index < (indexes[i] as number); index += 1) {
        const drawn = boxAt(index);
        if (
          drawn !== null &&
          drawn.minX <= box.maxX &&
          drawn.maxX >= box.minX &&
          drawn.minY <= box.maxY &&
          drawn.maxY >= box.minY
        ) {
          found.push(index);
        }
      }
    }
    return found;
  });
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function randomBox(random: () => number): AABB {
  const minX = Math.floor(random() * 100);
  const minY = Math.floor(random() * 100);
  return {
    minX,
    minY,
    maxX: minX + Math.floor(random() * 20),
    maxY: minY + Math.floor(random() * 20),
  };
}

describe('drawnOverClusters', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('agrees with scanning every gap (seed %i)', (seed) => {
    const random = seeded(seed);
    const count = 120;
    const boxes = Array.from({ length: count }, () => (random() < 0.15 ? null : randomBox(random)));
    const boxAt = (index: number): AABB | null => boxes[index] ?? null;
    const clusters = Array.from({ length: 12 }, () => {
      const indexes = [
        ...new Set(Array.from({ length: 5 }, () => Math.floor(random() * count))),
      ].sort((a, b) => a - b);
      return { indexes, box: randomBox(random) };
    });

    const swept = drawnOverClusters(clusters, count, boxAt);
    const inGaps = swept.map((found, position) => {
      const { indexes } = clusters[position] as DrawnCluster;
      return [...new Set(found)].filter((index) => !indexes.includes(index));
    });
    expect(inGaps).toEqual(bruteForce(clusters, boxAt));
  });

  it('counts a box that only touches the cluster, as the paint split always has', () => {
    const cluster = { indexes: [0, 2], box: { minX: 0, minY: 0, maxX: 10, maxY: 10 } };
    const touching = { minX: 10, minY: 10, maxX: 20, maxY: 20 };

    expect(drawnOverClusters([cluster], 3, () => touching)).toEqual([[1]]);
  });

  it('asks for no boxes when every cluster’s members are adjacent', () => {
    const cluster = { indexes: [3, 4, 5], box: { minX: 0, minY: 0, maxX: 10, maxY: 10 } };
    const boxAt = (): AABB => {
      throw new Error('asked for a box');
    };

    expect(drawnOverClusters([cluster], 6, boxAt)).toEqual([[]]);
  });
});
