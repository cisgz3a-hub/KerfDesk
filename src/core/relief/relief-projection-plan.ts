import { reliefCutterBudgetError } from './relief-cutter-budget';
import type { Polyline, CncTool } from '../scene';
import type { CncPass } from '../job';
import { partialCellCenter } from '../grid';
import { kernelForTool } from '../sim';
import type { Heightmap } from './heightmap';
import { createSurfaceContactField } from './heightmap-surface-contact';
import { checkedPath } from './relief-finishing-contact';
import type { FinishingPoint } from './relief-finishing-path';
import { createMaskStock } from './relief-mask-stock';
import { stockCheckedPath } from './relief-mask-stock-path';
import { CNC_MASK_EMISSION_XY_CLEARANCE_MM } from '../cnc/precision';

const MAX_PROJECTED_POINTS = 250_000;
export type ReliefProjectionPlan =
  | {
      readonly kind: 'ok';
      readonly passes: ReadonlyArray<CncPass>;
      readonly effectiveSpacingMm: number;
      readonly liftedVertices: number;
    }
  | { readonly kind: 'error'; readonly reason: string };

/** Vertical surface offset, with physical cutter contact and excluded stock kept intact. */
export function reliefProjectionPlan(
  map: Heightmap,
  polylines: ReadonlyArray<Polyline>,
  tool: CncTool,
  depthMm: number,
  requestedSpacingMm: number,
): ReliefProjectionPlan {
  if (!validProjectionParameters(depthMm, requestedSpacingMm))
    return {
      kind: 'error',
      reason: 'Relief projection depth and sample spacing must be positive finite millimetres.',
    };
  const spacingMm = Math.min(requestedSpacingMm, map.mmPerCell / 4, tool.diameterMm / 10);
  const count = pointCount(polylines, spacingMm);
  if (!Number.isFinite(count) || count > MAX_PROJECTED_POINTS)
    return {
      kind: 'error',
      reason:
        'Projected vectors exceed the bounded point budget at the requested surface resolution.',
    };
  const budgetError = reliefCutterBudgetError(tool, map.mmPerCell);
  if (budgetError !== null) return { kind: 'error', reason: budgetError };
  const kernel = kernelForTool(tool, map.mmPerCell);
  if (count * (2 * kernel.surfaceCandidateSpanCells + 3) ** 2 > 32_000_000)
    return {
      kind: 'error',
      reason:
        'Projected cutter contact exceeds the bounded work budget at the requested surface resolution.',
    };
  const contact = createSurfaceContactField(map, kernel);
  const stock = createMaskStock(map, kernel, CNC_MASK_EMISSION_XY_CLEARANCE_MM);
  const tipAt = (x: number, y: number, lower: number): number => {
    const tip = contact?.constraintAtPoint(x, y, lower + depthMm) ?? lower + depthMm;
    return Math.max(lower, tip - depthMm, stock?.tipAt(x, y) ?? Number.NEGATIVE_INFINITY);
  };
  const passes: CncPass[] = [];
  let liftedVertices = 0;
  for (const line of polylines) {
    const raw = sampledPath(line, spacingMm);
    if (
      raw.some(
        (p) => p.x < -1e-8 || p.y < -1e-8 || p.x > map.widthMm + 1e-8 || p.y > map.heightMm + 1e-8,
      )
    )
      return {
        kind: 'error',
        reason:
          'A projected vector leaves the target relief footprint. Move or clip that vector inside the named relief.',
      };
    const points = raw.map((p) => {
      const nominal = sampleSurface(map, p.x, p.y) - depthMm;
      const z = tipAt(p.x, p.y, nominal);
      if (z > nominal + 0.001) liftedVertices += 1;
      return { ...p, z };
    });
    const checked = checkedPath(points, { tipAt, spacingMm });
    const safe = stock === null ? checked : stockCheckedPath(checked, stock);
    if (safe.length > 1)
      passes.push({
        kind: 'path3d',
        points: safe,
        closed: line.closed,
        lateralFeed: 'z-rate-capped',
      });
  }
  return { kind: 'ok', passes, effectiveSpacingMm: spacingMm, liftedVertices };
}

function validProjectionParameters(depthMm: number, spacingMm: number): boolean {
  return [depthMm, spacingMm].every((value) => Number.isFinite(value) && value > 0);
}

function pointCount(polylines: ReadonlyArray<Polyline>, spacingMm: number): number {
  let count = 0;
  for (const line of polylines) {
    const points = closedPoints(line);
    count += 1;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1],
        b = points[i];
      if (a !== undefined && b !== undefined)
        count += Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / spacingMm));
    }
  }
  return count;
}
function sampledPath(line: Polyline, spacingMm: number): FinishingPoint[] {
  const points = closedPoints(line),
    out: FinishingPoint[] = [];
  const first = points[0];
  if (first !== undefined) out.push({ ...first, z: 0 });
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1],
      b = points[i];
    if (a === undefined || b === undefined) continue;
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / spacingMm));
    for (let k = 1; k <= count; k += 1)
      out.push({ x: a.x + ((b.x - a.x) * k) / count, y: a.y + ((b.y - a.y) * k) / count, z: 0 });
  }
  return out;
}
function closedPoints(line: Polyline): Polyline['points'] {
  const first = line.points[0],
    last = line.points[line.points.length - 1];
  return line.closed &&
    first !== undefined &&
    last !== undefined &&
    Math.hypot(last.x - first.x, last.y - first.y) > 1e-9
    ? [...line.points, first]
    : line.points;
}
function bracket(
  map: Heightmap,
  axis: 'x' | 'y',
  position: number,
): { low: number; high: number; fraction: number } {
  const size = axis === 'x' ? map.widthCells : map.heightCells;
  const low = Math.max(0, Math.min(size - 2, Math.floor(position / map.mmPerCell - 0.5)));
  const high = Math.min(size - 1, low + 1);
  const a = partialCellCenter(map, axis, low),
    b = partialCellCenter(map, axis, high);
  return { low, high, fraction: b === a ? 0 : Math.max(0, Math.min(1, (position - a) / (b - a))) };
}
function sampleSurface(map: Heightmap, x: number, y: number): number {
  const ix = bracket(map, 'x', x),
    iy = bracket(map, 'y', y);
  const read = (col: number, row: number): number => map.depth[row * map.widthCells + col] ?? 0;
  const bottom = read(ix.low, iy.low) * (1 - ix.fraction) + read(ix.high, iy.low) * ix.fraction;
  const top = read(ix.low, iy.high) * (1 - ix.fraction) + read(ix.high, iy.high) * ix.fraction;
  return bottom * (1 - iy.fraction) + top * iy.fraction;
}
