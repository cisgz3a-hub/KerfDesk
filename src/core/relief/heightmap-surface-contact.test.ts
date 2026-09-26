import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { partialCellCenter } from '../grid';
import type { CncTool } from '../scene';
import { kernelForTool, type ToolKernel } from '../sim';
import type { Heightmap } from './heightmap';
import { createSurfaceContactField } from './heightmap-surface-contact';

// ADR-412: the exact cutter contact with the triangulated heightmap. Known
// answers pin every closed form; an independent search oracle and dense
// surface samples check arbitrary masked and shortened-edge maps.

const FLAT: CncTool = { id: 'flat', name: 'flat', kind: 'end-mill', diameterMm: 1.4 };
const BALL: CncTool = { id: 'ball', name: 'ball', kind: 'ball-nose', diameterMm: 1.4 };
const V_BIT: CncTool = { id: 'v', name: 'v-bit', kind: 'v-bit', diameterMm: 1.4, tipAngleDeg: 60 };
const ENGRAVING: CncTool = {
  id: 'engraving',
  name: 'engraving',
  kind: 'engraving',
  diameterMm: 1.4,
  tipAngleDeg: 45,
  tipDiameterMm: 0.2,
};
const TAPERED: CncTool = {
  id: 'tapered',
  name: 'tapered ball',
  kind: 'tapered-ball-nose',
  diameterMm: 1.4,
  tipDiameterMm: 0.5,
  tipAngleDeg: 30,
};
const TOOLS = [FLAT, BALL, V_BIT, ENGRAVING, TAPERED] as const;

function rampMap(slopeX: number, slopeY: number, cells = 25, mmPerCell = 0.2): Heightmap {
  const depth = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      depth[j * cells + i] = -5 + slopeX * (i + 0.5) * mmPerCell + slopeY * (j + 0.5) * mmPerCell;
    }
  }
  return {
    widthCells: cells,
    heightCells: cells,
    widthMm: cells * mmPerCell,
    heightMm: cells * mmPerCell,
    mmPerCell,
    depth,
  };
}

function contactAt(map: Heightmap, kernel: ToolKernel, cx: number, cy: number): number {
  const field = createSurfaceContactField(map, kernel);
  if (field === null) throw new Error('expected a contact field');
  return field.constraint(cx, cy, Number.NEGATIVE_INFINITY);
}

describe('surface contact — known answers on a plane', () => {
  const MID = 12;
  const R = 0.7;

  function planeTip(tool: CncTool, slope: number): { actual: number; surface: number } {
    // A ramp along a diagonal exercises both triangle orientations.
    const along = slope / Math.SQRT2;
    const map = rampMap(along, along);
    const kernel = kernelForTool(tool, map.mmPerCell);
    return {
      actual: contactAt(map, kernel, MID, MID),
      surface: map.depth[MID * map.widthCells + MID] ?? 0,
    };
  }

  it.each([0, 0.3, 1, 2.5])('lifts a flat end mill by slope x radius (slope %s)', (slope) => {
    const { actual, surface } = planeTip(FLAT, slope);
    expect(actual).toBeCloseTo(surface + slope * R, 5);
  });

  it.each([0, 0.3, 1, 2.5, 6])('seats a ball on its tangent point (slope %s)', (slope) => {
    const { actual, surface } = planeTip(BALL, slope);
    expect(actual).toBeCloseTo(surface + R * (Math.sqrt(1 + slope * slope) - 1), 5);
  });

  it.each([0.5, 1.5])('keeps a v-bit on its tip below the flank slope (slope %s)', (slope) => {
    const { actual, surface } = planeTip(V_BIT, slope);
    expect(actual).toBeCloseTo(surface, 5);
  });

  it.each([2, 4])('moves a v-bit contact to the rim above the flank slope (slope %s)', (slope) => {
    const kernel = kernelForTool(V_BIT, 0.2);
    const { actual, surface } = planeTip(V_BIT, slope);
    expect(actual).toBeCloseTo(surface + slope * R - kernel.surfaceDzAtRadius(R), 5);
  });

  it.each([0.5, 2])('seats an engraving bit on its flat land edge (slope %s)', (slope) => {
    const { actual, surface } = planeTip(ENGRAVING, slope);
    expect(actual).toBeCloseTo(surface + slope * 0.1, 5);
  });

  it('moves an engraving contact to the rim above the flank slope', () => {
    const kernel = kernelForTool(ENGRAVING, 0.2);
    const { actual, surface } = planeTip(ENGRAVING, 4);
    expect(actual).toBeCloseTo(surface + 4 * R - kernel.surfaceDzAtRadius(R), 5);
  });

  it.each([0.3, 1])('seats a tapered ball on its ball below the flank (slope %s)', (slope) => {
    const ball = 0.25;
    const { actual, surface } = planeTip(TAPERED, slope);
    expect(actual).toBeCloseTo(surface + ball * (Math.sqrt(1 + slope * slope) - 1), 5);
  });

  it('moves a tapered ball contact to the rim above the flank slope', () => {
    const kernel = kernelForTool(TAPERED, 0.2);
    const { actual, surface } = planeTip(TAPERED, 6);
    expect(actual).toBeCloseTo(surface + 6 * R - kernel.surfaceDzAtRadius(R), 5);
  });
});

describe('surface contact — known answer on a ridge edge', () => {
  it.each([0.5, 0])('finds a ball contact on a ridge sloping %s between samples', (k) => {
    // Roof z = -3 + k x - m |y - y0| with the ridge on row 10; a ball centred
    // d = 0.3 mm off the ridge can only touch the ridge line itself.
    const mmPerCell = 0.1;
    const cells = 41;
    const ridgeRow = 10;
    const m = 8;
    const depth = new Float32Array(cells * 21);
    for (let j = 0; j < 21; j += 1) {
      for (let i = 0; i < cells; i += 1) {
        depth[j * cells + i] =
          -3 + k * (i + 0.5) * mmPerCell - m * Math.abs(j - ridgeRow) * mmPerCell;
      }
    }
    const map: Heightmap = {
      widthCells: cells,
      heightCells: 21,
      widthMm: cells * mmPerCell,
      heightMm: 21 * mmPerCell,
      mmPerCell,
      depth,
    };
    const R = 0.7;
    const d = 0.3;
    const cx = 20;
    const ridgeAtCenter = -3 + k * (cx + 0.5) * mmPerCell;
    const rho = Math.sqrt(R * R - d * d);
    const expected = ridgeAtCenter + rho * Math.sqrt(1 + k * k) - R;

    const actual = contactAt(map, kernelForTool(BALL, mmPerCell), cx, ridgeRow - 3);

    expect(actual).toBeCloseTo(expected, 5);
  });
});

describe('surface contact — level edges', () => {
  it('finds a v-bit contact at the nearest approach of a level edge', () => {
    // Found by the oracle property below: on a level edge the stationary
    // quadratic has a double root that rounding turned into no root.
    const depths = [
      0, 0, 0, 0, 0, 0, 0, 0, 0, -531, 0, 0, 0, 0, -685, -1216, -685, 0, 0, 0, -9, -531, 0, -463, 0,
      0, 0, 0, 0, 0,
    ];
    const map: Heightmap = {
      widthCells: 6,
      heightCells: 5,
      widthMm: 2.825,
      heightMm: 2.2,
      mmPerCell: 0.5,
      depth: Float32Array.from(depths, (depth) => depth / 1_000),
    };
    const kernel = kernelForTool(V_BIT, map.mmPerCell);
    // The level edge (2.25, 1.75)-(1.75, 2.1) at z = 0, seen from the sample
    // (1.75, 1.25): |(-0.5, 0.35) x (-0.5, -0.5)| / |(-0.5, 0.35)|.
    const nearest = 0.425 / Math.hypot(0.5, 0.35);
    expect(contactAt(map, kernel, 3, 2)).toBeCloseTo(-kernel.surfaceDzAtRadius(nearest), 6);
  });
});

describe('surface contact — field bounds', () => {
  it('has no field for a single sample or a zero-radius cutter', () => {
    const single: Heightmap = {
      widthCells: 1,
      heightCells: 1,
      widthMm: 1,
      heightMm: 1,
      mmPerCell: 1,
      depth: Float32Array.from([-1]),
    };
    expect(createSurfaceContactField(single, kernelForTool(BALL, 1))).toBeNull();
    const point: CncTool = { ...FLAT, diameterMm: 0 };
    expect(createSurfaceContactField(rampMap(0, 0), kernelForTool(point, 0.2))).toBeNull();
  });

  it('keeps a lower bound that the surface does not exceed', () => {
    const map = rampMap(0, 0);
    const field = createSurfaceContactField(map, kernelForTool(BALL, map.mmPerCell));
    expect(field?.constraint(3, 3, 0)).toBe(0);
    expect(field?.constraint(3, 3, -10)).toBeCloseTo(-5, 6);
  });

  it('never builds surface from mask-excluded samples', () => {
    const map: Heightmap = {
      ...rampMap(0, 0, 5, 1),
      depth: new Float32Array(25).fill(-4),
      inclusion: Uint8Array.from(Array.from({ length: 25 }, (_, index) => (index === 12 ? 0 : 1))),
    };
    map.depth[12] = 0;
    const kernel = kernelForTool({ ...FLAT, diameterMm: 3 }, 1);
    expect(contactAt(map, kernel, 1, 2)).toBeCloseTo(-4, 6);
  });
});

// --- Independent oracle ------------------------------------------------------
//
// Every point of a triangle or edge between included samples is a real contact
// candidate. On each edge the objective is concave, so a golden-section search
// plus both clipped endpoints finds its maximum. On each triangle the maximum
// over its plane within the cutter lies on the uphill ray from the axis; when
// that point is inside the triangle it is the triangle's maximum, and
// otherwise the maximum is on the triangle's edges.

type Point3 = { readonly x: number; readonly y: number; readonly z: number };

const ORACLE_ITERATIONS = 120;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

function goldenMaximum(f: (t: number) => number, lo: number, hi: number): number {
  let left = lo;
  let right = hi;
  for (let iteration = 0; iteration < ORACLE_ITERATIONS; iteration += 1) {
    const m1 = right - GOLDEN * (right - left);
    const m2 = left + GOLDEN * (right - left);
    if (f(m1) < f(m2)) left = m1;
    else right = m2;
  }
  return Math.max(f(lo), f(hi), f((left + right) / 2));
}

const RIM_ULPS_MM = 16 * Number.EPSILON;

// A contact grazing the rim can land a rounding error outside it; the field
// allows the same few ulps.
function oracleDz(kernel: ToolKernel, distance: number): number {
  return distance > kernel.radiusMm + RIM_ULPS_MM
    ? Number.POSITIVE_INFINITY
    : kernel.surfaceDzAtRadius(Math.min(kernel.radiusMm, distance));
}

function edgeOracle(kernel: ToolKernel, p: Point3, q: Point3, xc: number, yc: number): number {
  const ex = q.x - p.x;
  const ey = q.y - p.y;
  const fx = p.x - xc;
  const fy = p.y - yc;
  const a = ex * ex + ey * ey;
  const b = fx * ex + fy * ey;
  const reach = kernel.radiusMm + RIM_ULPS_MM;
  const disc = b * b - a * (fx * fx + fy * fy - reach * reach);
  if (disc < 0) return Number.NEGATIVE_INFINITY;
  const t0 = Math.max(0, (-b - Math.sqrt(disc)) / a);
  const t1 = Math.min(1, (-b + Math.sqrt(disc)) / a);
  if (t0 > t1) return Number.NEGATIVE_INFINITY;
  const value = (t: number): number =>
    p.z +
    t * (q.z - p.z) -
    oracleDz(kernel, Math.min(kernel.radiusMm, Math.hypot(fx + t * ex, fy + t * ey)));
  return goldenMaximum(value, t0, t1);
}

function planeOracle(
  kernel: ToolKernel,
  triangle: readonly [Point3, Point3, Point3],
  xc: number,
  yc: number,
): number {
  const [p0, p1, p2] = triangle;
  const e1 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
  const e2 = { x: p2.x - p0.x, y: p2.y - p0.y, z: p2.z - p0.z };
  const nz = e1.x * e2.y - e1.y * e2.x;
  const gx = -(e1.y * e2.z - e1.z * e2.y) / nz;
  const gy = -(e1.z * e2.x - e1.x * e2.z) / nz;
  const slope = Math.hypot(gx, gy);
  const ux = slope > 0 ? gx / slope : 0;
  const uy = slope > 0 ? gy / slope : 0;
  const height = (x: number, y: number): number => p0.z + gx * (x - p0.x) + gy * (y - p0.y);
  let bestRadius = 0;
  let bestValue = Number.NEGATIVE_INFINITY;
  const value = (r: number): number => height(xc + r * ux, yc + r * uy) - oracleDz(kernel, r);
  // Scan then refine: the ray objective is concave, so its peak bracket wins.
  const samples = 64;
  for (let s = 0; s <= samples; s += 1) {
    const r = (kernel.radiusMm * s) / samples;
    if (value(r) > bestValue) {
      bestValue = value(r);
      bestRadius = r;
    }
  }
  const step = kernel.radiusMm / samples;
  const lo = Math.max(0, bestRadius - step);
  const hi = Math.min(kernel.radiusMm, bestRadius + step);
  let left = lo;
  let right = hi;
  for (let iteration = 0; iteration < ORACLE_ITERATIONS; iteration += 1) {
    const m1 = right - GOLDEN * (right - left);
    const m2 = left + GOLDEN * (right - left);
    if (value(m1) < value(m2)) left = m1;
    else right = m2;
  }
  for (const r of [lo, hi, (left + right) / 2]) {
    if (value(r) > bestValue) {
      bestValue = value(r);
      bestRadius = r;
    }
  }
  const px = xc + bestRadius * ux;
  const py = yc + bestRadius * uy;
  return insideTriangle(triangle, px, py) ? bestValue : Number.NEGATIVE_INFINITY;
}

function insideTriangle(
  [p0, p1, p2]: readonly [Point3, Point3, Point3],
  x: number,
  y: number,
): boolean {
  const d0 = (p1.x - p0.x) * (y - p0.y) - (p1.y - p0.y) * (x - p0.x);
  const d1 = (p2.x - p1.x) * (y - p1.y) - (p2.y - p1.y) * (x - p1.x);
  const d2 = (p0.x - p2.x) * (y - p2.y) - (p0.y - p2.y) * (x - p2.x);
  return (d0 >= 0 && d1 >= 0 && d2 >= 0) || (d0 <= 0 && d1 <= 0 && d2 <= 0);
}

type Surface = {
  readonly edges: ReadonlyArray<readonly [Point3, Point3]>;
  readonly triangles: ReadonlyArray<readonly [Point3, Point3, Point3]>;
};

function triangulatedSurface(map: Heightmap): Surface {
  const sample = (i: number, j: number): Point3 | null => {
    if (i >= map.widthCells || j >= map.heightCells) return null;
    const index = j * map.widthCells + i;
    if (map.inclusion?.[index] === 0) return null;
    return {
      x: partialCellCenter(map, 'x', i),
      y: partialCellCenter(map, 'y', j),
      z: map.depth[index] ?? 0,
    };
  };
  const edges: Array<readonly [Point3, Point3]> = [];
  const triangles: Array<readonly [Point3, Point3, Point3]> = [];
  for (let j = 0; j < map.heightCells; j += 1) {
    for (let i = 0; i < map.widthCells; i += 1) {
      const a = sample(i, j);
      const b = sample(i + 1, j);
      const c = sample(i, j + 1);
      const d = sample(i + 1, j + 1);
      for (const [p, q] of [
        [a, b],
        [a, c],
        [a, d],
        [b, c],
      ] as const) {
        if (p !== null && q !== null) edges.push([p, q]);
      }
      for (const [p, q, r] of [
        [a, b, d],
        [a, d, c],
        [a, b, c],
        [b, d, c],
      ] as const) {
        if (p !== null && q !== null && r !== null) triangles.push([p, q, r]);
      }
    }
  }
  return { edges, triangles };
}

function oracleContact(kernel: ToolKernel, surface: Surface, xc: number, yc: number): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const [p, q] of surface.edges) best = Math.max(best, edgeOracle(kernel, p, q, xc, yc));
  for (const triangle of surface.triangles) {
    best = Math.max(best, planeOracle(kernel, triangle, xc, yc));
  }
  return best;
}

// Dense samples of every triangle: none may stand above the reported contact.
function densestSample(kernel: ToolKernel, surface: Surface, xc: number, yc: number): number {
  const steps = 10;
  let best = Number.NEGATIVE_INFINITY;
  for (const [p0, p1, p2] of surface.triangles) {
    for (let u = 0; u <= steps; u += 1) {
      for (let v = 0; u + v <= steps; v += 1) {
        const w0 = (steps - u - v) / steps;
        const w1 = u / steps;
        const w2 = v / steps;
        const x = w0 * p0.x + w1 * p1.x + w2 * p2.x;
        const y = w0 * p0.y + w1 * p1.y + w2 * p2.y;
        const distance = Math.hypot(x - xc, y - yc);
        if (distance > kernel.radiusMm) continue;
        const z = w0 * p0.z + w1 * p1.z + w2 * p2.z;
        best = Math.max(best, z - kernel.surfaceDzAtRadius(distance));
      }
    }
  }
  return best;
}

const WIDTH = 6;
const HEIGHT = 5;
const CELL_MM = 0.5;
const DEPTHS = fc.array(fc.integer({ min: -6_000, max: 0 }), {
  minLength: WIDTH * HEIGHT,
  maxLength: WIDTH * HEIGHT,
});
const MASK = fc.array(fc.boolean(), { minLength: WIDTH * HEIGHT, maxLength: WIDTH * HEIGHT });
// Planar-quad and pruning shortcuts are exact to 1e-6 mm, far below the
// 0.001 mm emit grid.
const TOLERANCE_MM = 3e-6;

describe('surface contact — independent oracle', () => {
  const cases = TOOLS.flatMap((tool) => [
    { tool, growthMm: 0 },
    { tool, growthMm: 0.3 },
  ]);

  it.each(cases)(
    'matches the oracle for $tool.kind grown by $growthMm mm',
    ({ tool, growthMm }) => {
      fc.assert(
        fc.property(DEPTHS, MASK, fc.boolean(), fc.boolean(), (depths, mask, masked, partial) => {
          const map: Heightmap = {
            widthCells: WIDTH,
            heightCells: HEIGHT,
            widthMm: partial ? 2.825 : WIDTH * CELL_MM,
            heightMm: partial ? 2.2 : HEIGHT * CELL_MM,
            mmPerCell: CELL_MM,
            depth: Float32Array.from(depths, (depth) => depth / 1_000),
            ...(masked ? { inclusion: Uint8Array.from(mask, (isIn) => (isIn ? 1 : 0)) } : {}),
          };
          const kernel = kernelForTool(tool, CELL_MM, 0, growthMm);
          const field = createSurfaceContactField(map, kernel);
          const surface = triangulatedSurface(map);
          for (let cy = 0; cy < HEIGHT; cy += 1) {
            for (let cx = 0; cx < WIDTH; cx += 1) {
              const xc = partialCellCenter(map, 'x', cx);
              const yc = partialCellCenter(map, 'y', cy);
              const actual = field?.constraint(cx, cy, Number.NEGATIVE_INFINITY);
              const expected = oracleContact(kernel, surface, xc, yc);
              if (expected === Number.NEGATIVE_INFINITY) {
                expect(actual).toBe(Number.NEGATIVE_INFINITY);
                continue;
              }
              expect(Math.abs((actual ?? 0) - expected)).toBeLessThanOrEqual(TOLERANCE_MM);
              expect(densestSample(kernel, surface, xc, yc)).toBeLessThanOrEqual(
                (actual ?? 0) + TOLERANCE_MM,
              );
            }
          }
        }),
        { numRuns: 8 },
      );
    },
  );
});
