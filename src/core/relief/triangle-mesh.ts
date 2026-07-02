// TriangleMesh — a triangle soup in model units (Phase H.4, ADR-094). The
// shared shape between the clean-room STL parsers (io/stl) and the relief
// heightmap sampler (core/relief). Lives in core so io → core imports stay
// one-directional.
//
// Layout: 9 floats per triangle (x1 y1 z1  x2 y2 z2  x3 y3 z3), row-major in
// file order. Normals are NOT stored — a 3-axis heightmap only needs
// positions, and STL normals are famously unreliable anyway.

export type TriangleMesh = {
  // length = triangleCount * 9
  readonly positions: Float32Array;
};

export const FLOATS_PER_TRIANGLE = 9;

export function triangleCount(mesh: TriangleMesh): number {
  return Math.floor(mesh.positions.length / FLOATS_PER_TRIANGLE);
}

export type MeshBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
};

export function meshBounds(mesh: TriangleMesh): MeshBounds | null {
  const p = mesh.positions;
  if (p.length < FLOATS_PER_TRIANGLE) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 2 < p.length; i += 3) {
    const x = p[i] ?? 0;
    const y = p[i + 1] ?? 0;
    const z = p[i + 2] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}
