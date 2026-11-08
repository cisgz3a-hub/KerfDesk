// ADR-580 Amendment 2: the triangulated pixel-centre surface of a height map.

import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { heightfieldExactSurface, MAX_EXACT_HEIGHTFIELD_QUADS } from './heightfield-exact-surface';
import { heightfieldToHeightmap } from './heightfield-to-heightmap';

function field(
  width: number,
  height: number,
  values: ReadonlyArray<number>,
  crop?: { x: number; y: number; width: number; height: number },
) {
  return testReliefHeightfield({
    width,
    height,
    physicalWidthMm: width,
    physicalHeightMm: height,
    maxDepthMm: 1,
    samplesU16: values,
    ...(crop === undefined ? {} : { mapping: { crop: { kind: 'normalized-v1', ...crop } } }),
  });
}

function triangleCount(triangles: Float64Array): number {
  return triangles.length / 9;
}

describe('heightfieldExactSurface', () => {
  it('reads every cell centre on the triangulated surface, not the highest pixel', () => {
    // A ramp across X: pixel i has depth -(1 - i/3), one millimetre pixels.
    const source = field(4, 2, [0, 21845, 43690, 65535, 0, 21845, 43690, 65535]);
    const grid = { widthCells: 16, heightCells: 8, widthMm: 4, heightMm: 2, mmPerCell: 0.25 };
    const result = heightfieldExactSurface(source, grid, (sx) => -(1 - sx / 3));
    expect(result).toBeDefined();
    for (let i = 0; i < grid.widthCells; i += 1) {
      const x = (i + 0.5) * grid.mmPerCell;
      // Pixel centres sit at 0.5, 1.5, 2.5, 3.5 mm; outside them the edge pixel holds.
      const s = Math.min(3, Math.max(0, x - 0.5));
      expect(result?.depth[3 * grid.widthCells + i]).toBeCloseTo(-(1 - s / 3), 6);
    }
  });

  it('splits each quad along its higher diagonal, the upper envelope of both', () => {
    // A saddle: corners (0,0) and (1,1) high, the other two low.
    const source = field(2, 2, [65535, 0, 0, 65535]);
    const grid = { widthCells: 2, heightCells: 2, widthMm: 2, heightMm: 2, mmPerCell: 1 };
    const depthAt = (sx: number, sy: number): number => (sx === sy ? 0 : -1);
    const result = heightfieldExactSurface(source, grid, depthAt);
    expect(result).toBeDefined();
    // Between the four pixel centres the higher diagonal runs (0.5,0.5)-(1.5,1.5),
    // so the quad's middle stands at the stock top, not halfway down.
    const triangles = result?.exactSurface.triangles ?? new Float64Array();
    const middle = { x: 1, y: 1 };
    let highest = Number.NEGATIVE_INFINITY;
    for (let t = 0; t < triangleCount(triangles); t += 1) {
      const p = Array.from({ length: 3 }, (_, k) => ({
        x: triangles[t * 9 + k * 3] ?? 0,
        y: triangles[t * 9 + k * 3 + 1] ?? 0,
        z: triangles[t * 9 + k * 3 + 2] ?? 0,
      }));
      const [a, b, c] = p as [(typeof p)[0], (typeof p)[0], (typeof p)[0]];
      const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      const l1 = ((b.y - c.y) * (middle.x - c.x) + (c.x - b.x) * (middle.y - c.y)) / det;
      const l2 = ((c.y - a.y) * (middle.x - c.x) + (a.x - c.x) * (middle.y - c.y)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      highest = Math.max(highest, l1 * a.z + l2 * b.z + l3 * c.z);
    }
    expect(highest).toBeCloseTo(0, 9);
  });

  it('places a cropped field by its crop, with the edge vertices at the relief edge', () => {
    // Keep the middle half of an 8-pixel row.
    const source = field(8, 1, new Array(8).fill(0), { x: 0.25, y: 0, width: 0.5, height: 1 });
    const grid = { widthCells: 4, heightCells: 1, widthMm: 8, heightMm: 1, mmPerCell: 2 };
    const result = heightfieldExactSurface(source, grid, () => -0.5);
    const triangles = result?.exactSurface.triangles ?? new Float64Array();
    const xs = new Set<number>();
    for (let v = 0; v < triangles.length; v += 3) xs.add(Number((triangles[v] ?? 0).toFixed(9)));
    // Pixels 2..5 of the source span the 8 mm relief; the level row is one
    // rectangle from its left edge to its right edge.
    expect([...xs].sort((a, b) => a - b)).toEqual([0, 8]);
    expect(result?.depth.every((value) => value === -0.5)).toBe(true);
  });

  it('keeps the highest-pixel cells over the budget', () => {
    const side = Math.ceil(Math.sqrt(MAX_EXACT_HEIGHTFIELD_QUADS)) + 2;
    const source = { ...field(1, 1, [0]), width: side, height: side };
    const grid = { widthCells: 1, heightCells: 1, widthMm: 1, heightMm: 1, mmPerCell: 1 };
    expect(heightfieldExactSurface(source, grid, () => 0)).toBeUndefined();
  });
});

describe('heightfieldToHeightmap with an exact surface', () => {
  it('attaches the surface only when asked and when nothing is excluded', () => {
    const values = [0, 65535, 0, 65535];
    const options = { targetWidthMm: 2, reliefDepthMm: 1, mmPerCell: 0.5 };
    const plain = heightfieldToHeightmap(field(2, 2, values), options);
    const exact = heightfieldToHeightmap(field(2, 2, values), { ...options, exactSurface: true });
    const masked = heightfieldToHeightmap(
      testReliefHeightfield({
        width: 2,
        height: 2,
        physicalWidthMm: 2,
        physicalHeightMm: 2,
        maxDepthMm: 1,
        samplesU16: values,
        inclusionMask: [0, 255, 255, 255],
      }),
      { ...options, exactSurface: true },
    );
    if (plain.kind !== 'ok' || exact.kind !== 'ok' || masked.kind !== 'ok')
      throw new Error('materialization failed');
    expect(plain.heightmap.exactSurface).toBeUndefined();
    expect(exact.heightmap.exactSurface?.triangles.length).toBeGreaterThan(0);
    expect(masked.heightmap.exactSurface).toBeUndefined();
    // Highest pixel per cell before; the surface through the pixel centres now.
    expect(Array.from(plain.heightmap.depth.slice(0, 4))).toEqual([-1, -1, 0, 0]);
    expect(Array.from(exact.heightmap.depth.slice(0, 4))).toEqual([-1, -0.75, -0.25, 0]);
  });
});
