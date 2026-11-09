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
import { zPassArrayMaterializationError, zPassDepths } from '../cnc/depth-passes';
import { withProjectionTabs, type ProjectionTabWindows } from './relief-projection-tabs';

const MAX_PROJECTED_POINTS = 250_000;
// Emitted projected vertices across every level, the same order of size the
// 2D profile ladders reach; past it the operator raises Depth per pass.
const MAX_PROJECTED_LEVEL_POINTS = 4_000_000;
const Z_EPS = 1e-6;
// A loop whose every point keeps no more than this above the stock bottom is
// cut free: a bridge this thin does not hold a part (X6-P1-1).
const FREE_MM = 0.1;

/** What the compiled projection really cut, for Job Review (W6-P2-1). */
export type ReliefProjectionFacts = {
  // Most step-down levels any vector was cut in.
  readonly levels: number;
  // Deepest emitted tip, positive mm below the stock top; 0 when nothing cut.
  readonly deepestMm: number;
  readonly closedShapes: number;
  // Closed loops whose passes rise into at least one tab.
  readonly tabbedShapes: number;
  // Closed loops cut through the stock bottom all the way round: freed parts.
  readonly freedShapes: number;
  // Rolling audit v12 X6-P1-1: the thinnest material left where a tabbed loop
  // stays attached (at or above its tab top), measured from the stock bottom
  // to the lower of the emitted tip and the relief surface. A tab can only be
  // as thick as the floor the relief leaves under it. Absent without tabs.
  readonly thinnestTabMm?: number;
  // X6-P2-1: how far above the relief surface the ladder starts, because the
  // target is only roughed before this operation. Absent when it starts there.
  readonly startAboveMm?: number;
};

export type ReliefProjectionOptions = {
  // The layer's Depth per pass: the projection steps down from the surface by
  // it, as Vectric's projected profiles keep their pass depth. Absent or
  // unusable: one pass at the full vertical depth.
  readonly depthPerPassMm?: number;
  readonly stockThicknessMm?: number;
  // X6-P2-1: the stock the target relief leaves above its surface before this
  // operation (its roughing allowance and terraces when it is only roughed).
  // The ladder steps down from there. Absent or 0: from the surface.
  readonly startAboveMm?: number;
  // Profile layers with Tabs on: the windows, and the tab top for a loop
  // whose deepest checked tip is `deepestZ`, or null when it needs no tab.
  readonly tabs?: ProjectionTabWindows & {
    readonly tabTopZ: (deepestZ: number) => number | null;
  };
};

export type ReliefProjectionPlan =
  | {
      readonly kind: 'ok';
      readonly passes: ReadonlyArray<CncPass>;
      readonly effectiveSpacingMm: number;
      readonly liftedVertices: number;
      readonly facts: ReliefProjectionFacts;
    }
  | { readonly kind: 'error'; readonly reason: string };

/** Vertical surface offset, with physical cutter contact and excluded stock kept intact. */
export function reliefProjectionPlan(
  map: Heightmap,
  polylines: ReadonlyArray<Polyline>,
  tool: CncTool,
  depthMm: number,
  requestedSpacingMm: number,
  options: ReliefProjectionOptions = {},
): ReliefProjectionPlan {
  const admitted = admitProjection(map, polylines, tool, depthMm, requestedSpacingMm, options);
  if (admitted.kind === 'error') return admitted;
  const { spacingMm, levelDepths, kernel } = admitted;
  const contact = createSurfaceContactField(map, kernel);
  const stock = createMaskStock(map, kernel, CNC_MASK_EMISSION_XY_CLEARANCE_MM);
  const tipAt = (x: number, y: number, lower: number): number => {
    const tip = contact?.constraintAtPoint(x, y, lower + depthMm) ?? lower + depthMm;
    return Math.max(lower, tip - depthMm, stock?.tipAt(x, y) ?? Number.NEGATIVE_INFINITY);
  };
  const passes: CncPass[] = [];
  const facts: MutableFacts = {
    levels: 0,
    deepestZ: 0,
    closedShapes: 0,
    tabbedShapes: 0,
    freedShapes: 0,
    thinnestTabMm: Number.POSITIVE_INFINITY,
  };
  let liftedVertices = 0;
  for (const line of polylines) {
    const raw = sampledPath(line, spacingMm);
    if (raw.some((p) => outsideMap(map, p)))
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
      addLadder(
        passes,
        facts,
        line.closed,
        projectedLadder(safe, levelDepths, line.closed, options, (x, y) =>
          sampleSurface(map, x, y),
        ),
      );
  }
  const { deepestZ, thinnestTabMm, ...counts } = facts;
  const aboveMm = startAbove(options);
  return {
    kind: 'ok',
    passes,
    effectiveSpacingMm: spacingMm,
    liftedVertices,
    facts: {
      ...counts,
      deepestMm: Math.max(0, -deepestZ),
      ...(Number.isFinite(thinnestTabMm) ? { thinnestTabMm: Math.max(0, thinnestTabMm) } : {}),
      ...(aboveMm > 0 ? { startAboveMm: aboveMm } : {}),
    },
  };
}

// The facts as the loop gathers them, with the deepest tip still a Z.
type MutableFacts = {
  levels: number;
  deepestZ: number;
  closedShapes: number;
  tabbedShapes: number;
  freedShapes: number;
  thinnestTabMm: number;
};

function addLadder(
  passes: CncPass[],
  facts: MutableFacts,
  closed: boolean,
  ladder: ReturnType<typeof projectedLadder>,
): void {
  for (const level of ladder.levels)
    passes.push({ kind: 'path3d', points: level, closed, lateralFeed: 'z-rate-capped' });
  facts.levels = Math.max(facts.levels, ladder.levels.length);
  facts.deepestZ = Math.min(facts.deepestZ, ladder.deepestZ);
  if (!closed) return;
  facts.closedShapes += 1;
  if (ladder.freed) facts.freedShapes += 1;
  else if (ladder.tabs > 0) {
    facts.tabbedShapes += 1;
    facts.thinnestTabMm = Math.min(facts.thinnestTabMm, ladder.thinnestTabMm);
  }
}

// The parameter, point and work budgets, checked before any contact is solved.
function admitProjection(
  map: Heightmap,
  polylines: ReadonlyArray<Polyline>,
  tool: CncTool,
  depthMm: number,
  requestedSpacingMm: number,
  options: ReliefProjectionOptions,
):
  | {
      readonly kind: 'ok';
      readonly spacingMm: number;
      readonly levelDepths: ReadonlyArray<number>;
      readonly kernel: ReturnType<typeof kernelForTool>;
    }
  | { readonly kind: 'error'; readonly reason: string } {
  const error = (reason: string) => ({ kind: 'error', reason }) as const;
  if (!validProjectionParameters(depthMm, requestedSpacingMm))
    return error('Relief projection depth and sample spacing must be positive finite millimetres.');
  const stepMm = options.depthPerPassMm ?? depthMm;
  const aboveMm = startAbove(options);
  const ladderError = zPassArrayMaterializationError(depthMm + aboveMm, stepMm);
  if (ladderError !== null) return error(ladderError);
  // Depths below the surface, shallow to deep; the last is the vertical depth.
  // A roughed-only target starts the ladder above the surface (X6-P2-1).
  const levelDepths = zPassDepths(depthMm + aboveMm, stepMm).map((z) => -z - aboveMm);
  const spacingMm = Math.min(requestedSpacingMm, map.mmPerCell / 4, tool.diameterMm / 10);
  const count = pointCount(polylines, spacingMm);
  if (!Number.isFinite(count) || count > MAX_PROJECTED_POINTS)
    return error(
      'Projected vectors exceed the bounded point budget at the requested surface resolution.',
    );
  if (count * levelDepths.length > MAX_PROJECTED_LEVEL_POINTS)
    return error(
      'Projected step-down levels exceed the bounded point budget. Raise Depth per pass or shorten the projected vectors.',
    );
  const budgetError = reliefCutterBudgetError(tool, map.mmPerCell);
  if (budgetError !== null) return error(budgetError);
  const kernel = kernelForTool(tool, map.mmPerCell);
  if (count * (2 * kernel.surfaceCandidateSpanCells + 3) ** 2 > 32_000_000)
    return error(
      'Projected cutter contact exceeds the bounded work budget at the requested surface resolution.',
    );
  return { kind: 'ok', spacingMm, levelDepths, kernel };
}

function startAbove(options: ReliefProjectionOptions): number {
  const above = options.startAboveMm ?? 0;
  return Number.isFinite(above) && above > 0 ? above : 0;
}

function outsideMap(map: Heightmap, p: { readonly x: number; readonly y: number }): boolean {
  return p.x < -1e-8 || p.y < -1e-8 || p.x > map.widthMm + 1e-8 || p.y > map.heightMm + 1e-8;
}

// The step-down ladder of one checked projected path (W6-P2-1). The deepest
// level is the checked path itself. Each shallower level is the same path
// lifted by the depth it does not yet take: the path clears the cutter contact
// offset by the full vertical depth, so lifted it clears the contact offset by
// the level's own depth, and lifting never meets excluded stock. A closed loop
// that reaches the tab top takes the same tabs on every level.
//
// What the loop leaves is judged on the emitted last level against the relief
// surface (rolling audit v12 X6-P1-1, X6-P3-2): at each point the material
// stands from the stock bottom up to the lower of the tip and the surface. A
// tab window above an already deeper relief rides in air, so its tab is only
// the floor left there; a loop with no point keeping more than FREE_MM is cut
// free, tabs or not; and the deepest tip is the deepest emitted one.
function projectedLadder(
  safe: ReadonlyArray<FinishingPoint>,
  levelDepths: ReadonlyArray<number>,
  closed: boolean,
  options: ReliefProjectionOptions,
  surfaceAt: (x: number, y: number) => number,
): {
  readonly levels: ReadonlyArray<ReadonlyArray<FinishingPoint>>;
  readonly tabs: number;
  readonly freed: boolean;
  readonly deepestZ: number;
  readonly thinnestTabMm: number;
} {
  const finalDepth = levelDepths[levelDepths.length - 1] ?? 0;
  const tabTopZ =
    closed && options.tabs !== undefined ? options.tabs.tabTopZ(extremeZ(safe, 'min')) : null;
  let tabs = 0;
  const levels = levelDepths.map((depth) => {
    const lift = finalDepth - depth;
    const lifted = lift > 0 ? safe.map((p) => ({ ...p, z: p.z + lift })) : safe;
    if (tabTopZ === null || options.tabs === undefined) return lifted;
    const tabbed = withProjectionTabs(lifted, tabTopZ, options.tabs);
    if (depth === finalDepth) tabs = tabbed.tabs;
    return tabbed.points;
  });
  const last = levels[levels.length - 1] ?? [];
  const left = leftAlong(last, options.stockThicknessMm, surfaceAt);
  const freed = closed && left !== null && last.length > 0 && left.most <= FREE_MM;
  const thinnestTabMm =
    left === null || tabTopZ === null ? Number.POSITIVE_INFINITY : left.thinnestAt(tabTopZ);
  return { levels, tabs, freed, deepestZ: extremeZ(last, 'min'), thinnestTabMm };
}

// The material each point of a level leaves above the stock bottom.
function leftAlong(
  level: ReadonlyArray<FinishingPoint>,
  stockMm: number | undefined,
  surfaceAt: (x: number, y: number) => number,
): { readonly most: number; readonly thinnestAt: (tabTopZ: number) => number } | null {
  if (stockMm === undefined) return null;
  const left = level.map((p) => Math.min(p.z, surfaceAt(p.x, p.y)) + stockMm);
  let most = Number.NEGATIVE_INFINITY;
  for (const value of left) most = Math.max(most, value);
  return {
    most,
    thinnestAt: (tabTopZ) => {
      let thinnest = Number.POSITIVE_INFINITY;
      level.forEach((p, i) => {
        if (p.z >= tabTopZ - Z_EPS) thinnest = Math.min(thinnest, left[i] ?? thinnest);
      });
      return thinnest;
    },
  };
}

function extremeZ(points: ReadonlyArray<FinishingPoint>, which: 'min' | 'max'): number {
  let out = which === 'min' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  for (const p of points) out = which === 'min' ? Math.min(out, p.z) : Math.max(out, p.z);
  return out;
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
