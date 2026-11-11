// The motion a Lihuiyu job commands (ADR-703), planned once in whole 1/1000 in
// steps so the writer (lhy-encoder.ts) and the export's checks read the same
// moves. Each point is rounded from its job coordinate, never accumulated, so
// rounding cannot drift. Line groups travel between segments in rapid mode;
// Fill and Image groups stay in program mode and cross their gaps with the
// beam off, as the board's rows are short and many.
//
// Image rows run as program-mode sweeps: each row's burn runs from its first
// to its last lit pixel, the beam switching with the pixels, and two-way rows
// alternate direction. MeerK40t's native raster mode (V…G step codes) is not
// written by this build.

import type { CutGroup, FillGroup, RasterGroup } from '../../job';
import { cutSegmentsForPass, finalPassCutSegments } from '../../job/cut-pass-segments';
import { rasterRowsInProviderOrder } from '../../job/raster-rows';
import type { Vec2 } from '../../scene';

export const LHY_STEPS_PER_MM = 1000 / 25.4;

export type LhyPoint = { readonly x: number; readonly y: number };
export type LhyStep = LhyPoint & { readonly burn: boolean };
export type LhyBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type LhyGroup = CutGroup | FillGroup | RasterGroup;

/** One layer group's moves. `travel` says how its laser-off steps run. */
export type LhyMotionPart = {
  readonly part: number;
  readonly group: LhyGroup;
  readonly travel: 'rapid' | 'program';
  readonly steps: ReadonlyArray<LhyStep>;
  /** The bounds of the steps that burn. */
  readonly bounds: LhyBounds;
};

export function mmToLhySteps(mm: number): number {
  return Math.round(mm * LHY_STEPS_PER_MM);
}

export function lhyPoint(point: Vec2): LhyPoint {
  return { x: mmToLhySteps(point.x), y: mmToLhySteps(point.y) };
}

export function planLhyPart(group: LhyGroup, part: number): LhyMotionPart | null {
  const steps = group.kind === 'raster' ? rasterSteps(group) : vectorSteps(group);
  const bounds = burnBounds(steps);
  if (bounds === null) return null;
  return { part, group, travel: group.kind === 'cut' ? 'rapid' : 'program', steps, bounds };
}

function vectorSteps(group: CutGroup | FillGroup): LhyStep[] {
  const steps: LhyStep[] = [];
  const passes = Math.max(1, group.passes);
  const finalPass = group.kind === 'cut' ? finalPassCutSegments(group) : group.segments;
  for (let pass = 0; pass < passes; pass += 1) {
    const segments =
      group.kind === 'cut'
        ? cutSegmentsForPass(group, finalPass, pass, passes)
        : (group.segments as ReadonlyArray<{ readonly polyline: ReadonlyArray<Vec2> }>);
    for (const segment of segments) addPolyline(steps, segment.polyline);
  }
  return steps;
}

function addPolyline(steps: LhyStep[], polyline: ReadonlyArray<Vec2>): void {
  const points = polyline.map(lhyPoint);
  const first = points[0];
  if (first === undefined || points.length < 2) return;
  const burns = points.slice(1).filter((point, i) => !samePoint(point, points[i] ?? first));
  // A segment that collapses to one step burns nothing, so it gets no travel.
  if (burns.length === 0) return;
  steps.push({ ...first, burn: false });
  for (const point of burns) steps.push({ ...point, burn: true });
}

function rasterSteps(group: RasterGroup): LhyStep[] {
  const steps: LhyStep[] = [];
  const { bounds, pixelWidth, pixelHeight } = group;
  if (pixelWidth <= 0 || pixelHeight <= 0) return steps;
  const pixelWidthMm = (bounds.maxX - bounds.minX) / pixelWidth;
  const pixelHeightMm = (bounds.maxY - bounds.minY) / pixelHeight;
  const xAt = (pixel: number): number => mmToLhySteps(bounds.minX + pixel * pixelWidthMm);
  let emitted = 0;
  for (let pass = 0; pass < Math.max(1, group.passes); pass += 1) {
    for (const { rowIndex, row } of rasterRowsInProviderOrder(group)) {
      const runs = litRuns(row);
      if (runs.length === 0) continue;
      const y = mmToLhySteps(bounds.minY + (rowIndex + 0.5) * pixelHeightMm);
      const reverse = (group.bidirectional ?? true) && emitted % 2 === 1;
      emitted += 1;
      const ordered = reverse ? [...runs].reverse() : runs;
      for (const [first, last] of ordered) {
        const [from, to] = reverse ? [last + 1, first] : [first, last + 1];
        steps.push({ x: xAt(from), y, burn: false }, { x: xAt(to), y, burn: true });
      }
    }
  }
  return steps;
}

/** Inclusive [first, last] pixel ranges whose power is above zero. */
function litRuns(row: ArrayLike<number>): Array<readonly [number, number]> {
  const runs: Array<readonly [number, number]> = [];
  let start = -1;
  for (let i = 0; i <= row.length; i += 1) {
    const lit = i < row.length && (row[i] ?? 0) > 0;
    if (lit && start < 0) start = i;
    if (!lit && start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  return runs;
}

function burnBounds(steps: ReadonlyArray<LhyStep>): LhyBounds | null {
  let bounds: LhyBounds | null = null;
  let previous: LhyStep | undefined;
  for (const step of steps) {
    if (step.burn && previous !== undefined) {
      bounds = grow(grow(bounds, previous), step);
    }
    previous = step;
  }
  return bounds;
}

function grow(bounds: LhyBounds | null, point: LhyPoint): LhyBounds {
  if (bounds === null) return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
  return {
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  };
}

export function unionLhyBounds(parts: ReadonlyArray<{ readonly bounds: LhyBounds }>): LhyBounds {
  const [first, ...rest] = parts;
  if (first === undefined) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return rest.reduce<LhyBounds>(
    (acc, part) =>
      grow(grow(acc, { x: part.bounds.minX, y: part.bounds.minY }), {
        x: part.bounds.maxX,
        y: part.bounds.maxY,
      }),
    first.bounds,
  );
}

function samePoint(a: LhyPoint, b: LhyPoint): boolean {
  return a.x === b.x && a.y === b.y;
}
