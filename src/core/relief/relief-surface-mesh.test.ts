import { describe, expect, it } from 'vitest';
import type { Heightmap } from './heightmap';
import { reliefSurfaceMesh } from './relief-surface-mesh';

function heightmap(widthCells: number, heightCells: number, depths: number[]): Heightmap {
  return {
    widthCells,
    heightCells,
    mmPerCell: 2,
    depth: Float32Array.from(depths),
  };
}

describe('reliefSurfaceMesh', () => {
  it('places one vertex per cell center with the cell depth as Z', () => {
    const mesh = reliefSurfaceMesh(heightmap(2, 2, [0, -1, -2, -3]));

    expect(mesh.positions).toHaveLength(2 * 2 * 3);
    // First vertex: cell (0,0) center = (1,1), depth 0.
    expect([...mesh.positions.slice(0, 3)]).toEqual([1, 1, 0]);
    // Last vertex: cell (1,1) center = (3,3), depth −3.
    expect([...mesh.positions.slice(9, 12)]).toEqual([3, 3, -3]);
    expect(mesh.widthMm).toBe(4);
    expect(mesh.heightMm).toBe(4);
  });

  it('triangulates each cell quad into two triangles with valid indices', () => {
    const mesh = reliefSurfaceMesh(heightmap(3, 2, [0, 0, 0, 0, 0, 0]));

    // 2×1 quads → 2 quads × 6 indices.
    expect(mesh.indices).toHaveLength(12);
    for (const index of mesh.indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(6);
    }
    // Every triangle references three DISTINCT vertices.
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const tri = new Set([mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]);
      expect(tri.size).toBe(3);
    }
  });

  it('handles degenerate single-row heightmaps without indices', () => {
    const mesh = reliefSurfaceMesh(heightmap(3, 1, [0, -1, 0]));
    expect(mesh.positions).toHaveLength(9);
    expect(mesh.indices).toHaveLength(0);
  });
});
