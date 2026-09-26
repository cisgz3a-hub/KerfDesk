// Independent search oracle for the exact surface contact (ADR-412), shared by
// the sample and point contact tests.
import { partialCellCenter } from '../grid';
import type { ToolKernel } from '../sim';
import type { Heightmap } from './heightmap';

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

export type Surface = {
  readonly edges: ReadonlyArray<readonly [Point3, Point3]>;
  readonly triangles: ReadonlyArray<readonly [Point3, Point3, Point3]>;
};

export function triangulatedSurface(map: Heightmap): Surface {
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

export function oracleContact(
  kernel: ToolKernel,
  surface: Surface,
  xc: number,
  yc: number,
): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const [p, q] of surface.edges) best = Math.max(best, edgeOracle(kernel, p, q, xc, yc));
  for (const triangle of surface.triangles) {
    best = Math.max(best, planeOracle(kernel, triangle, xc, yc));
  }
  return best;
}

// Dense samples of every triangle: none may stand above the reported contact.
export function densestSample(
  kernel: ToolKernel,
  surface: Surface,
  xc: number,
  yc: number,
): number {
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
