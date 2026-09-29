import { describe, expect, it } from 'vitest';
import { rasterizeTriangleFootprintMaxZ } from './triangle-footprint-raster';
import { rasterizeTriangleMaxZ, type RasterTarget } from './triangle-raster';

// ADR-412 Amendment 1: relief CAM reads each cell as the highest point of the
// mesh over the cell's whole footprint, not at its centre. Checked against the
// centre rasterizer and against an independent Sutherland–Hodgman clip of each
// triangle to each closed cell (z carried along the clipped edges).

type Triangle = readonly [number, number, number, number, number, number, number, number, number];
type Rasterize = typeof rasterizeTriangleMaxZ;
type Vertex = { readonly x: number; readonly y: number; readonly z: number };

// Unit cells, so vertex coordinates are cell coordinates.
function raster(
  widthCells: number,
  heightCells: number,
  triangles: ReadonlyArray<Triangle>,
  rasterize: Rasterize = rasterizeTriangleFootprintMaxZ,
): Float32Array {
  const maxZ = new Float32Array(widthCells * heightCells).fill(Number.NEGATIVE_INFINITY);
  const target: RasterTarget = {
    widthCells,
    heightCells,
    widthMm: widthCells,
    heightMm: heightCells,
    mmPerCell: 1,
    maxZ,
  };
  for (const triangle of triangles) rasterize(target, ...triangle);
  return maxZ;
}

function clipHalfPlane(polygon: ReadonlyArray<Vertex>, side: (vertex: Vertex) => number): Vertex[] {
  const out: Vertex[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if (sa >= 0 !== sb >= 0) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) });
    }
  }
  return out;
}

// The oracle: highest z of the triangle clipped to the closed unit cell.
function clippedMaxZ(triangle: Triangle, left: number, bottom: number): number {
  const [x1, y1, z1, x2, y2, z2, x3, y3, z3] = triangle;
  let polygon: Vertex[] = [
    { x: x1, y: y1, z: z1 },
    { x: x2, y: y2, z: z2 },
    { x: x3, y: y3, z: z3 },
  ];
  polygon = clipHalfPlane(polygon, (v) => v.x - left);
  polygon = clipHalfPlane(polygon, (v) => left + 1 - v.x);
  polygon = clipHalfPlane(polygon, (v) => v.y - bottom);
  polygon = clipHalfPlane(polygon, (v) => bottom + 1 - v.y);
  return polygon.reduce((best, vertex) => Math.max(best, vertex.z), Number.NEGATIVE_INFINITY);
}

// Deterministic LCG in [0, 1).
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// Mixed sizes: sub-cell slivers and specks, cell-sized, and wide triangles;
// every tenth one collinear (a vertical wall seen from above).
function randomTriangle(next: () => number, width: number, height: number): Triangle {
  const span = [0.3, 1.5, width][Math.floor(next() * 3)]!;
  const cx = next() * width;
  const cy = next() * height;
  const point = (): [number, number] => [
    Math.min(width, Math.max(0, cx + (next() - 0.5) * span)),
    Math.min(height, Math.max(0, cy + (next() - 0.5) * span)),
  ];
  const [x1, y1] = point();
  const [x2, y2] = point();
  const [x3, y3] = next() < 0.1 ? [(x1 + x2) / 2, (y1 + y2) / 2] : point();
  return [x1, y1, next() * 10, x2, y2, next() * 10, x3, y3, next() * 10];
}

describe('rasterizeTriangleFootprintMaxZ', () => {
  it('raises a cell that a triangle covers only in part, away from its centre', () => {
    // A flat speck in the corner of cell 0, and a ramp z = 10 (x - 0.7)
    // across the boundary between cells 0 and 1; neither covers a centre.
    const speck: Triangle = [0.05, 0.1, 2, 0.4, 0.1, 2, 0.05, 0.35, 2];
    const ramp: Triangle = [0.7, 0.6, 0, 1.3, 0.6, 6, 0.7, 0.9, 0];

    expect([...raster(2, 1, [speck, ramp], rasterizeTriangleMaxZ)]).toEqual([
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);
    const cells = raster(2, 1, [speck, ramp]);
    // Cell 0 peaks where the ramp crosses x = 1; cell 1 at the ramp's vertex.
    expect(cells[0]).toBeCloseTo(3, 6);
    expect(cells[1]).toBe(6);
  });

  it('lifts every cell a raised strip narrower than a cell touches', () => {
    // A 0.4-wide strip between the centres of cells 1 and 2, standing 4 above
    // a floor at 0 that covers the whole 4 x 1 grid.
    const floor: Triangle[] = [
      [0, 0, 0, 4, 0, 0, 4, 1, 0],
      [0, 0, 0, 4, 1, 0, 0, 1, 0],
    ];
    const strip: Triangle[] = [
      [1.8, 0, 4, 2.2, 0, 4, 2.2, 1, 4],
      [1.8, 0, 4, 2.2, 1, 4, 1.8, 1, 4],
    ];

    expect([...raster(4, 1, [...floor, ...strip], rasterizeTriangleMaxZ)]).toEqual([0, 0, 0, 0]);
    expect([...raster(4, 1, [...floor, ...strip])]).toEqual([0, 4, 4, 0]);
  });

  it('lifts the cells under the top edge of a vertical wall', () => {
    // Zero plan area along x = 1.5: the centre rasterizer cannot see it.
    const wall: Triangle[] = [
      [1.5, 0.2, 0, 1.5, 1.8, 0, 1.5, 1.8, 4],
      [1.5, 0.2, 0, 1.5, 1.8, 4, 1.5, 0.2, 4],
    ];

    expect([...raster(3, 2, wall, rasterizeTriangleMaxZ)].every((z) => z === -Infinity)).toBe(true);
    expect([...raster(3, 2, wall)]).toEqual([-Infinity, 4, -Infinity, -Infinity, 4, -Infinity]);
  });

  it('counts a triangle that only touches a cell boundary (closed footprint)', () => {
    // Its right edge lies on x = 1, the left side of cell 1.
    const triangle: Triangle = [0.2, 0.2, 1, 1, 0.2, 5, 1, 0.8, 5];

    expect([...raster(3, 1, [triangle])]).toEqual([5, 5, Number.NEGATIVE_INFINITY]);
  });

  it('is the exact highest point of triangle ∩ cell on random triangles', () => {
    const next = random(412);
    const width = 7;
    const height = 5;
    let compared = 0;
    for (let trial = 0; trial < 400; trial += 1) {
      const triangle = randomTriangle(next, width, height);
      const cells = raster(width, height, [triangle]);
      for (let cy = 0; cy < height; cy += 1) {
        for (let cx = 0; cx < width; cx += 1) {
          const expected = clippedMaxZ(triangle, cx, cy);
          const actual = cells[cy * width + cx]!;
          if (expected === Number.NEGATIVE_INFINITY) {
            expect(actual).toBe(Number.NEGATIVE_INFINITY);
          } else {
            expect(actual).toBeCloseTo(expected, 5);
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it('never reads a cell below its centre sample', () => {
    const next = random(98);
    const triangles = Array.from({ length: 300 }, () => randomTriangle(next, 9, 6));
    const centre = raster(9, 6, triangles, rasterizeTriangleMaxZ);
    const footprint = raster(9, 6, triangles);

    for (let index = 0; index < centre.length; index += 1) {
      // The two evaluate the same plane in different ways; allow rounding.
      expect(footprint[index]!).toBeGreaterThanOrEqual(centre[index]! - 1e-5);
    }
  });

  it('does not depend on triangle order', () => {
    const next = random(7);
    const triangles = Array.from({ length: 200 }, () => randomTriangle(next, 8, 8));

    expect(raster(8, 8, [...triangles].reverse())).toEqual(raster(8, 8, triangles));
  });
});
