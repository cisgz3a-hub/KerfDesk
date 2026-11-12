import { describe, expect, it } from 'vitest';
import { insideDistanceMm } from './distance-transform';

// Oracle audit O10-P3-3: the chamfer's error against a brute-force Euclidean
// distance. The (1, sqrt 2) weights are exact along axes and diagonals and
// overestimate most 22.5 degrees off an axis, by sqrt(4 - 2 sqrt 2) - 1.
const CHAMFER_WORST_RATIO = Math.sqrt(4 - 2 * Math.SQRT2);

describe('insideDistanceMm', () => {
  it('stays within the chamfer bound of the exact Euclidean distance', () => {
    const size = 61;
    const mmPerCell = 0.5;
    const grid = { widthCells: size, heightCells: size, mmPerCell, originX: 0, originY: 0 };
    const mask = new Uint8Array(size * size).fill(1);
    const seed = { x: 5, y: 5 };
    mask[seed.y * size + seed.x] = 0;
    const distance = insideDistanceMm(mask, grid);

    let worst = 1;
    for (let y = 0; y < size; y += 1)
      for (let x = 0; x < size; x += 1) {
        if (mask[y * size + x] === 0) continue;
        // The nearest outside cell is the seed or the ring just past the grid edge.
        const toEdge = Math.min(x + 1, y + 1, size - x, size - y);
        const exactCells = Math.min(Math.hypot(x - seed.x, y - seed.y), toEdge);
        worst = Math.max(worst, (distance[y * size + x] ?? 0) / (exactCells * mmPerCell));
      }

    expect(worst).toBeLessThanOrEqual(CHAMFER_WORST_RATIO + 1e-6);
    // The bound is reached, so the module comment must not promise less.
    expect(worst).toBeGreaterThan(1.08);
  });

  it('is exact along the axes and diagonals', () => {
    const size = 21;
    const grid = { widthCells: size, heightCells: size, mmPerCell: 1, originX: 0, originY: 0 };
    const mask = new Uint8Array(size * size).fill(1);
    mask[10 * size + 10] = 0;
    const distance = insideDistanceMm(mask, grid);
    expect(distance[10 * size + 14]).toBeCloseTo(4, 6);
    expect(distance[14 * size + 14]).toBeCloseTo(4 * Math.SQRT2, 5);
  });
});
