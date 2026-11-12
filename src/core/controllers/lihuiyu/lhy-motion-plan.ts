// The motion a Lihuiyu job commands (ADR-703), planned once in whole 1/1000 in
// steps so the writer (lhy-encoder.ts) and the export's checks read the same
// moves. Each point is rounded from its job coordinate, never accumulated, so
// rounding cannot drift. Line groups travel between segments in rapid mode;
// Fill and Image groups stay in program mode and cross their gaps with the
// beam off, as the board's rows are short and many.
//
// Fill sweeps and Image rows come from the planners the G-code route uses
// (ADR-703 Amendment 1, code quality audit C2 D6-P1-3): planFillSweeps and
// planRasterRowSweeps, with the bidirectional scan offset (the layer's value,
// else the machine's speed table), the runway policy and overscan, and Dot
// width correction. Each sweep runs in program mode: laser-off along the
// runway to the first ink, burns across the ink, laser-off across gaps and the
// exit runway. MeerK40t's native raster mode (V…G step codes) is not written
// by this build.

import { samePoint } from '../../geometry/point-math';
import type { CutGroup, FillGroup, RasterGroup } from '../../job';
import { cutSegmentsForPass, finalPassCutSegments } from '../../job/cut-pass-segments';
import { rasterRowsInProviderOrder } from '../../job/raster-rows';
import type { ScanOffsetPoint } from '../../devices/scan-offset-profile';
import { expandFillHatchWithRunways } from '../../job/fill-runway';
import { planFillSweeps } from '../../job/fill-sweep-plan';
import { offsetForSpeed, rasterRowShiftX } from '../../job/scan-offset';
import { planRasterRowSweeps, type RasterRowSweepPlan } from '../../raster/raster-sweep-plan';
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

export function planLhyPart(
  group: LhyGroup,
  part: number,
  scanningOffsets: ReadonlyArray<ScanOffsetPoint> = [],
): LhyMotionPart | null {
  // The scan offset a two-way Fill or Image moves each row by, resolved as on
  // G-code: the layer's value, else the machine's speed table.
  const offsetMm =
    group.kind === 'cut'
      ? 0
      : (group.bidirectionalScanOffsetMm ?? offsetForSpeed(scanningOffsets, group.speed));
  const steps =
    group.kind === 'raster'
      ? rasterSteps(group, offsetMm)
      : group.kind === 'fill' && (group.fillStyle ?? 'scanline') !== 'offset'
        ? fillSteps(group, offsetMm)
        : vectorSteps(group);
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

/** A Scan Line Fill's sweeps, as the G-code Fill runs them. */
function fillSteps(group: FillGroup, offsetMm: number): LhyStep[] {
  const steps: LhyStep[] = [];
  const plans = planFillSweeps(group, offsetMm);
  for (let pass = 0; pass < Math.max(1, group.passes); pass += 1) {
    for (const plan of plans) {
      const spans = plan.sweep.spans;
      const first = spans[0];
      const last = spans[spans.length - 1];
      if (first === undefined || last === undefined) continue;
      const run = expandFillHatchWithRunways([first.start, last.end], plan);
      if (run === null) continue;
      pushStep(steps, run.leadStart, false);
      pushStep(steps, run.burnStart, false);
      for (const span of spans) {
        pushStep(steps, span.start, false);
        pushStep(steps, span.end, true);
      }
      pushStep(steps, run.leadEnd, false);
    }
  }
  return steps;
}

/** Image rows, as the G-code raster runs them (emit-raster-sweep.ts). */
function rasterSteps(group: RasterGroup, offsetMm: number): LhyStep[] {
  const steps: LhyStep[] = [];
  const { bounds, pixelWidth, pixelHeight } = group;
  if (pixelWidth <= 0 || pixelHeight <= 0) return steps;
  const pixelWidthMm = (bounds.maxX - bounds.minX) / pixelWidth;
  const pixelHeightMm = (bounds.maxY - bounds.minY) / pixelHeight;
  const bidirectional = group.bidirectional ?? true;
  for (let pass = 0; pass < Math.max(1, group.passes); pass += 1) {
    let emitted = 0;
    for (const { rowIndex, row } of rasterRowsInProviderOrder(group)) {
      const reverse = bidirectional && emitted % 2 === 1;
      const sweeps = planRasterRowSweeps({
        row,
        pixelWidthMm,
        overscanMm: group.overscanMm,
        reverse,
        dotWidthCorrectionMm: Math.max(0, group.dotWidthCorrectionMm),
        minXWorldMm: bounds.minX,
      });
      if (sweeps.length === 0) continue;
      emitted += 1;
      const y = bounds.minY + (rowIndex + 0.5) * pixelHeightMm;
      const shift = rasterRowShiftX(offsetMm, reverse, bidirectional);
      for (const sweep of sweeps)
        rowSweepSteps(steps, sweep, { group, pixelWidthMm, y, shift, reverse });
    }
  }
  return steps;
}

type RowSweep = {
  readonly group: RasterGroup;
  readonly pixelWidthMm: number;
  readonly y: number;
  readonly shift: number;
  readonly reverse: boolean;
};

function rowSweepSteps(steps: LhyStep[], sweep: RasterRowSweepPlan, row: RowSweep): void {
  const { group, pixelWidthMm, y, shift, reverse } = row;
  const activeStartX = group.bounds.minX + sweep.span.firstX * pixelWidthMm;
  const activeEndX = group.bounds.minX + (sweep.span.lastX + 1) * pixelWidthMm;
  const startX =
    sweep.sharedLeadStartXWorldMm ??
    (reverse ? activeEndX + sweep.leadInMm : activeStartX - sweep.leadInMm);
  const endX =
    sweep.sharedLeadEndXWorldMm ??
    (reverse ? activeStartX - sweep.leadOutMm : activeEndX + sweep.leadOutMm);
  pushStep(steps, { x: startX + shift, y }, false);
  pushStep(steps, { x: (reverse ? activeEndX : activeStartX) + shift, y }, false);
  for (const run of sweep.runs) pushStep(steps, { x: run.endXWorldMm + shift, y }, run.s > 0);
  pushStep(steps, { x: endX + shift, y }, false);
}

/** Adds a step in board units unless the head is already there. */
function pushStep(steps: LhyStep[], point: Vec2, burn: boolean): void {
  const at = lhyPoint(point);
  const previous = steps[steps.length - 1];
  if (previous !== undefined && samePoint(previous, at)) return;
  steps.push({ ...at, burn });
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
