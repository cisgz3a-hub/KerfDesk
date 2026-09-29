import { describe, expect, it } from 'vitest';
import { meshToHeightmap, type MeshHeightmapOptions } from './mesh-to-heightmap';
import type { TriangleMesh } from './triangle-mesh';

// ADR-412 Amendment 1: relief CAM samples a mesh with 'footprint-max', so each
// cell holds the highest point of the mesh over the whole cell. Previews keep
// the centre sample, which stays the default.

type Box = readonly [number, number, number, number, number]; // x0 y0 x1 y1 top

// Flat-topped boxes with vertical walls down to z = 0, the way an STL models
// them (the walls have no plan area).
function boxesMesh(boxes: ReadonlyArray<Box>): TriangleMesh {
  const p: number[] = [];
  for (const [x0, y0, x1, y1, top] of boxes) {
    p.push(x0, y0, top, x1, y0, top, x1, y1, top, x0, y0, top, x1, y1, top, x0, y1, top);
    const corners = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ] as const;
    for (let i = 0; i < 4; i += 1) {
      const [ax, ay] = corners[i]!;
      const [bx, by] = corners[(i + 1) % 4]!;
      p.push(ax, ay, 0, bx, by, 0, bx, by, top, ax, ay, 0, bx, by, top, ax, ay, top);
    }
  }
  return { positions: Float32Array.from(p) };
}

function sampled(mesh: TriangleMesh, options: MeshHeightmapOptions): Float32Array {
  const result = meshToHeightmap(mesh, options);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.heightmap.depth;
}

// 4 x 4 mm with 0.8 mm cells: centres at 0.4, 1.2, 2.0, 2.8, 3.6.
const RIB_OPTIONS = { targetWidthMm: 4, reliefDepthMm: 4, mmPerCell: 0.8 } as const;
// A 0.4 mm rib standing 4 mm proud of the floor, between the centres 2.0 and 2.8.
const RIB_MESH = boxesMesh([
  [0, 0, 4, 4, 0],
  [2.1, 0, 2.5, 4, 4],
]);

function row(depth: Float32Array, index: number, width: number): number[] {
  return [...depth.slice(index * width, (index + 1) * width)];
}

describe('meshToHeightmap footprint sampling', () => {
  it('keeps a rib narrower than a cell, between two centres, at full height', () => {
    const centre = sampled(RIB_MESH, RIB_OPTIONS);
    const footprint = sampled(RIB_MESH, { ...RIB_OPTIONS, sampling: 'footprint-max' });

    for (let r = 0; r < 5; r += 1) {
      // Centre sampling never lands on the rib; each cell it touches holds its top.
      expect(row(centre, r, 5)).toEqual([-4, -4, -4, -4, -4]);
      expect(row(footprint, r, 5)).toEqual([-4, -4, 0, 0, -4]);
    }
  });

  it('reads a short terminal cell only as far as the mesh reaches', () => {
    // z rises from 0 to 10 across the model; 1 mm in 0.3 mm cells leaves a
    // 0.1 mm terminal cell. Each cell holds the ramp at its right edge.
    const ramp: TriangleMesh = {
      positions: Float32Array.from([0, 0, 0, 20, 0, 10, 20, 20, 10, 0, 0, 0, 20, 20, 10, 0, 20, 0]),
    };
    const result = meshToHeightmap(ramp, {
      targetWidthMm: 1,
      reliefDepthMm: 10,
      mmPerCell: 0.3,
      sampling: 'footprint-max',
    });
    if (result.kind !== 'ok') throw new Error(result.reason);

    expect(result.heightmap).toMatchObject({ widthCells: 4, heightCells: 4, widthMm: 1 });
    for (let r = 0; r < 4; r += 1) {
      const depths = row(result.heightmap.depth, r, 4);
      [-7, -4, -1, 0].forEach((expected, index) => expect(depths[index]).toBeCloseTo(expected, 5));
    }
  });

  it.each(['floor', 'top'] as const)('is never below the centre map (%s background)', (empty) => {
    // A pyramid plus off-grid boxes, some reaching past the pyramid's base.
    const pyramid = [
      0, 0, 0, 20, 0, 0, 10, 10, 9, 20, 0, 0, 20, 20, 0, 10, 10, 9, 20, 20, 0, 0, 20, 0, 10, 10, 9,
      0, 20, 0, 0, 0, 0, 10, 10, 9,
    ];
    const boxes = boxesMesh([
      [2.13, 3.3, 2.61, 17.9, 6],
      [13.02, 11.1, 23.7, 11.43, 10],
      [5.5, 21.2, 9.1, 25, 3],
    ]).positions;
    const mesh = { positions: Float32Array.from([...pyramid, ...boxes]) };
    const options = { targetWidthMm: 30, reliefDepthMm: 5, mmPerCell: 0.7, emptyCells: empty };
    const centre = sampled(mesh, options);
    const footprint = sampled(mesh, { ...options, sampling: 'footprint-max' });

    let raised = 0;
    for (let index = 0; index < centre.length; index += 1) {
      expect(footprint[index]!).toBeGreaterThanOrEqual(centre[index]! - 1e-5);
      if (footprint[index]! > centre[index]! + 1e-3) raised += 1;
    }
    expect(raised).toBeGreaterThan(0);
  });

  it("keeps 'top' background where no triangle covers the centre", () => {
    // A low shelf reaches 0.2 mm into cell 4 ([3.2, 4.0]), whose centre it
    // misses; a high block past the gap sets the stock top.
    const mesh = boxesMesh([
      [0, 0, 3.4, 4, 1],
      [7, 0, 8, 4, 5],
    ]);
    const options = { targetWidthMm: 8, reliefDepthMm: 5, mmPerCell: 0.8 } as const;
    const top = sampled(mesh, { ...options, emptyCells: 'top', sampling: 'footprint-max' });
    const floor = sampled(mesh, { ...options, emptyCells: 'floor', sampling: 'footprint-max' });

    expect(row(top, 0, 10).slice(3, 5)).toEqual([-4, 0]);
    expect(row(floor, 0, 10).slice(3, 5)).toEqual([-4, -4]);
  });

  it.each([2_000_000, Number.MAX_VALUE])(
    'reads a one-cell domain at the highest point of the mesh (pitch %s)',
    (mmPerCell) => {
      const ramp: TriangleMesh = {
        positions: Float32Array.from([
          0, 0, 0, 20, 0, 10, 20, 20, 10, 0, 0, 0, 20, 20, 10, 0, 20, 0,
        ]),
      };
      const result = meshToHeightmap(ramp, {
        targetWidthMm: 1,
        reliefDepthMm: 10,
        mmPerCell,
        sampling: 'footprint-max',
      });
      if (result.kind !== 'ok') throw new Error(result.reason);

      expect(result.heightmap).toMatchObject({ widthCells: 1, heightCells: 1 });
      expect([...result.heightmap.depth]).toEqual([0]);
    },
  );
});
