import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Heightmap } from '../relief';
import { steppedSurfaceMesh } from './stepped-surface-mesh';

const FLOATS_PER_VERTEX = 3;
const VERTICES_PER_QUAD = 4;
const INDICES_PER_QUAD = 6;

function heightmap(widthCells: number, heightCells: number, depth: readonly number[]): Heightmap {
  return {
    widthCells,
    heightCells,
    mmPerCell: 1,
    depth: Float32Array.from(depth),
  } as Heightmap;
}

function quadCount(mesh: { readonly indices: Uint32Array }): number {
  return mesh.indices.length / INDICES_PER_QUAD;
}

function normalAt(
  mesh: { readonly normals: Float32Array },
  vertex: number,
): [number, number, number] {
  const at = vertex * FLOATS_PER_VERTEX;
  return [mesh.normals[at] ?? 0, mesh.normals[at + 1] ?? 0, mesh.normals[at + 2] ?? 0];
}

describe('steppedSurfaceMesh', () => {
  it('emits one flat quad per cell and no walls for a flat field', () => {
    const mesh = steppedSurfaceMesh(heightmap(3, 2, [0, 0, 0, 0, 0, 0]));

    // 6 cells, zero height differences anywhere, so zero wall quads.
    expect(quadCount(mesh)).toBe(6);
    expect(mesh.positions.length).toBe(6 * VERTICES_PER_QUAD * FLOATS_PER_VERTEX);
  });

  it('emits exactly one wall quad for a single step between two cells', () => {
    // Two cells side by side, one 2 mm lower: one top quad each, one wall.
    const mesh = steppedSurfaceMesh(heightmap(2, 1, [0, -2]));

    expect(quadCount(mesh)).toBe(3);
  });

  it('spans the wall quad between the two neighbouring heights', () => {
    const mesh = steppedSurfaceMesh(heightmap(2, 1, [0, -2]));

    // The wall is the third quad; its four Z values must be exactly the pair of
    // neighbouring heights, never an interpolated midpoint.
    const wallStart = 2 * VERTICES_PER_QUAD;
    const wallZ = [0, 1, 2, 3].map(
      (i) => mesh.positions[(wallStart + i) * FLOATS_PER_VERTEX + 2] ?? Number.NaN,
    );
    expect([...wallZ].sort((a, b) => a - b)).toEqual([-2, -2, 0, 0]);
  });

  it('authors straight-up normals on top faces and horizontal normals on walls', () => {
    const mesh = steppedSurfaceMesh(heightmap(2, 1, [0, -2]));

    // Top faces point straight up — a wall must never bleed into a floor normal.
    expect(normalAt(mesh, 0)).toEqual([0, 0, 1]);
    expect(normalAt(mesh, VERTICES_PER_QUAD)).toEqual([0, 0, 1]);
    // The wall's normal is horizontal: zero Z component, unit length in XY.
    const wallNormal = normalAt(mesh, 2 * VERTICES_PER_QUAD);
    expect(wallNormal[2]).toBe(0);
    expect(Math.abs(wallNormal[0]) + Math.abs(wallNormal[1])).toBe(1);
  });

  it('points each wall normal away from the taller cell', () => {
    // Left cell taller: the exposed face looks toward +X (the lower neighbour).
    const rightLower = steppedSurfaceMesh(heightmap(2, 1, [0, -2]));
    expect(normalAt(rightLower, 2 * VERTICES_PER_QUAD)).toEqual([1, 0, 0]);

    // Mirror the step and the normal must flip, not stay put.
    const leftLower = steppedSurfaceMesh(heightmap(2, 1, [-2, 0]));
    expect(normalAt(leftLower, 2 * VERTICES_PER_QUAD)).toEqual([-1, 0, 0]);
  });

  it('winds every quad so its right-hand normal matches the authored normal', () => {
    // If winding and authored normal disagree, the mesh renders inside-out the
    // moment anything draws it single-sided. Checked on a field with walls
    // running in both axes and in both directions.
    const mesh = steppedSurfaceMesh(heightmap(3, 3, [0, -1, 0, -1, -3, -1, 0, -1, 0]));

    for (let quad = 0; quad < quadCount(mesh); quad += 1) {
      const base = quad * VERTICES_PER_QUAD;
      const corner = (i: number): [number, number, number] => {
        const at = (base + i) * FLOATS_PER_VERTEX;
        return [mesh.positions[at] ?? 0, mesh.positions[at + 1] ?? 0, mesh.positions[at + 2] ?? 0];
      };
      const p0 = corner(0);
      const p1 = corner(1);
      const p2 = corner(2);
      const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]] as const;
      const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]] as const;
      const cross = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const length = Math.hypot(...cross);
      expect(length).toBeGreaterThan(0);
      const authored = normalAt(mesh, base);
      cross.forEach((component, axis) => {
        expect(component / length).toBeCloseTo(authored[axis] ?? 0, 10);
      });
    }
  });

  it('returns empty geometry for a zero-cell field rather than throwing', () => {
    const mesh = steppedSurfaceMesh(heightmap(0, 0, []));

    expect(mesh.positions.length).toBe(0);
    expect(mesh.indices.length).toBe(0);
    expect(mesh.widthMm).toBe(0);
  });

  it('reports millimetre extents from cell count and cell size', () => {
    const mesh = steppedSurfaceMesh({
      widthCells: 4,
      heightCells: 3,
      mmPerCell: 0.5,
      depth: new Float32Array(12),
    } as Heightmap);

    expect(mesh.widthMm).toBe(2);
    expect(mesh.heightMm).toBe(1.5);
  });

  it('keeps buffers exactly sized and every index in range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 6 }),
        fc.array(fc.integer({ min: -3, max: 0 }), { minLength: 36, maxLength: 36 }),
        (widthCells, heightCells, depths) => {
          const mesh = steppedSurfaceMesh(
            heightmap(widthCells, heightCells, depths.slice(0, widthCells * heightCells)),
          );

          // Exactly sized: a mis-counted wall pass would leave zero-filled slack
          // at the tail, which renders as a stray quad at the origin.
          const quads = quadCount(mesh);
          expect(mesh.positions.length).toBe(quads * VERTICES_PER_QUAD * FLOATS_PER_VERTEX);
          expect(mesh.normals.length).toBe(mesh.positions.length);
          expect(Number.isInteger(quads)).toBe(true);

          const vertices = quads * VERTICES_PER_QUAD;
          for (const index of mesh.indices) {
            expect(index).toBeLessThan(vertices);
          }
          // Never fewer quads than cells: every cell owns one top face.
          expect(quads).toBeGreaterThanOrEqual(widthCells * heightCells);
        },
      ),
    );
  });
});
