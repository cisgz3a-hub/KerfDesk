import { describe, expect, it } from 'vitest';
import * as three from 'three';
import type { Heightmap } from './heightmap';
import { reliefSurfaceMesh, reliefSurfaceMeshWithNormals } from './relief-surface-mesh';

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

  it('omits every preview quad that touches an excluded cell', () => {
    const map: Heightmap = {
      ...heightmap(3, 2, [0, 0, 0, 0, 0, 0]),
      inclusion: Uint8Array.from([1, 1, 0, 1, 1, 0]),
    };
    const mesh = reliefSurfaceMesh(map);

    expect([...mesh.indices]).toEqual([0, 3, 1, 1, 3, 4]);
  });

  it('authors the same normals Three previously computed after the viewer reflection', () => {
    const map = heightmap(3, 3, [0, -1, 0, -2, -3, -1, 0, -1, 0]);
    const plain = reliefSurfaceMesh(map);
    const expected = new three.BufferGeometry();
    expected.setAttribute('position', new three.BufferAttribute(plain.positions.slice(), 3));
    expected.setIndex(new three.BufferAttribute(plain.indices.slice(), 1));
    expected.scale(1, -1, 1);
    expected.translate(-plain.widthMm / 2, plain.heightMm / 2, 0);
    expected.computeVertexNormals();

    const prepared = reliefSurfaceMeshWithNormals(map);
    const actual = new three.BufferGeometry();
    actual.setAttribute('position', new three.BufferAttribute(prepared.positions.slice(), 3));
    actual.setIndex(new three.BufferAttribute(prepared.indices.slice(), 1));
    actual.setAttribute('normal', new three.BufferAttribute(prepared.normals.slice(), 3));
    actual.scale(1, -1, 1);
    actual.translate(-prepared.widthMm / 2, prepared.heightMm / 2, 0);

    const expectedNormals = expected.getAttribute('normal').array;
    const actualNormals = actual.getAttribute('normal').array;
    expect(actualNormals).toHaveLength(expectedNormals.length);
    for (let index = 0; index < expectedNormals.length; index += 1) {
      expect(actualNormals[index]).toBeCloseTo(expectedNormals[index] ?? 0, 6);
    }
    expected.dispose();
    actual.dispose();
  });
});
