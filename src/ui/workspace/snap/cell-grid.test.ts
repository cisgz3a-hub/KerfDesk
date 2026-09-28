import { describe, expect, it } from 'vitest';
import { buildBoxGrid, buildPointGrid, forEachEntryNear } from './cell-grid';

describe('cell grid', () => {
  it('visits every point inside the query box and few outside it', () => {
    const count = 10_000;
    const xs = new Float64Array(count);
    const ys = new Float64Array(count);
    for (let i = 0; i < count; i += 1) {
      xs[i] = (i % 100) + 0.5;
      ys[i] = Math.floor(i / 100) + 0.5;
    }
    const grid = buildPointGrid(xs, ys, count);
    const box = { minX: 40, minY: 40, maxX: 43, maxY: 43 };

    const visited: number[] = [];
    forEachEntryNear(grid, box, (entry) => {
      visited.push(entry);
      return true;
    });

    const inside = visited.filter((entry) => {
      const x = xs[entry] ?? NaN;
      const y = ys[entry] ?? NaN;
      return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
    });
    expect(inside).toHaveLength(9);
    expect(visited.length).toBeLessThan(100);
  });

  it('visits nothing for a box off the data, and stops when told to', () => {
    const xs = Float64Array.from([0, 1, 2, 3]);
    const ys = Float64Array.from([0, 1, 2, 3]);
    const grid = buildPointGrid(xs, ys, 4);
    let visits = 0;

    forEachEntryNear(grid, { minX: 50, minY: 50, maxX: 60, maxY: 60 }, () => {
      visits += 1;
      return true;
    });
    expect(visits).toBe(0);

    const finished = forEachEntryNear(grid, { minX: -10, minY: -10, maxX: 10, maxY: 10 }, () => {
      visits += 1;
      return false;
    });
    expect(finished).toBe(false);
    expect(visits).toBe(1);
  });

  it('files a long box entry on the wide list, visited by every query', () => {
    // 2000 tiny boxes along a diagonal and one box spanning all of them.
    const small = 2000;
    const boxes = new Float64Array((small + 1) * 4);
    for (let i = 0; i < small; i += 1) {
      boxes.set([i / 10, i / 10, i / 10 + 0.05, i / 10 + 0.05], i * 4);
    }
    boxes.set([0, 0, 200, 200], small * 4);
    const grid = buildBoxGrid(boxes, small + 1);

    const visited = new Set<number>();
    forEachEntryNear(grid, { minX: 150, minY: 150, maxX: 150.2, maxY: 150.2 }, (entry) => {
      visited.add(entry);
      return true;
    });

    expect(Array.from(grid.wide)).toEqual([small]);
    expect(visited.has(small)).toBe(true);
    expect(visited.has(1500)).toBe(true);
    expect(visited.has(10)).toBe(false);
  });
});
