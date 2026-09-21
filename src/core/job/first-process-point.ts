import {
  cncContourEmissionPrecision,
  formatCncContourCoordinate,
  parseGrblCncCoordinate,
} from '../cnc/cnc-contour-emission';
import { circularArcGeometry, isCircularArcFullCircle } from '../geometry/arc-representation';
import { planRasterRowSweeps, type RasterRowSweepPlan } from '../raster/raster-sweep-plan';
import { assertNever, type Vec2 } from '../scene';
import { cncHelicalContourCanEmit } from './cnc-helical-representation';
import { isEmittableFillSegment } from './fill-emission-resolution';
import { expandFillHatchWithRunways } from './fill-runway';
import { planFillSweeps } from './fill-sweep-plan';
import { groupFillScanlines } from './fill-sweeps';
import type { CncPass, FillGroup, FillSegment, Job, RasterGroup } from './job';
import { rasterRowsInProviderOrder } from './raster-rows';
import { offsetForEmittedFeed, shiftAlongTravel } from './scan-offset';
import type { BuildToolpathOptions } from './toolpath-types';

/** The first cut-step XY, without allocating every travel/cut step in the job.
 * Entry runways, plunges and initial/park travel do not change this marker. */
export function firstToolpathProcessPoint(
  job: Job,
  options: BuildToolpathOptions = {},
): Vec2 | null {
  for (const group of job.groups) {
    let point: Vec2 | null = null;
    switch (group.kind) {
      case 'cut':
        if (group.passes > 0) point = firstContourPoint(group.segments);
        break;
      case 'fill':
        if (group.passes > 0) {
          point =
            group.fillStyle === 'offset'
              ? firstContourPoint(group.segments)
              : firstFillProcessPoint(group, options);
        }
        break;
      case 'raster':
        point = firstRasterProcessPoint(group, options);
        break;
      case 'cnc':
        point = firstCncGroupPoint(group.passes);
        break;
      default:
        assertNever(group, 'Group');
    }
    if (point !== null) return point;
  }
  return null;
}

function firstContourPoint(
  segments: ReadonlyArray<{ readonly polyline: ReadonlyArray<Vec2> }>,
): Vec2 | null {
  for (const segment of segments) {
    const point = segment.polyline[0];
    if (point !== undefined) return point;
  }
  return null;
}

function firstFillProcessPoint(group: FillGroup, options: BuildToolpathOptions): Vec2 | null {
  const offset =
    group.bidirectionalScanOffsetMm ??
    offsetForEmittedFeed(options.scanningOffsets ?? [], group.speed);
  let scanline: FillSegment[] = [];
  for (const source of group.segments) {
    const segment = shiftedFillSegment(source, offset);
    if (segment === null) continue;
    if (group.fillRunwayPolicy === 'feed-matched-every-sweep' && !isEmittableFillSegment(segment)) {
      continue;
    }
    const first = scanline[0];
    // Reuse the planner's collinearity/direction rule. Only one lookahead
    // segment is needed; later scanlines and later groups remain untouched.
    if (first !== undefined && groupFillScanlines([first, segment]).length > 1) {
      const point = firstPlannedFillPoint(group, scanline);
      if (point !== null) return point;
      scanline = [];
    }
    scanline.push(segment);
  }
  return firstPlannedFillPoint(group, scanline);
}

function shiftedFillSegment(segment: FillSegment, offset: number): FillSegment | null {
  const start = segment.polyline[0];
  const end = segment.polyline[1];
  if (start === undefined || end === undefined || segment.polyline.length !== 2) return null;
  if (!segment.reverse || offset === 0) return segment;
  const shifted = shiftAlongTravel(start, end, offset);
  return { ...segment, polyline: [shifted.from, shifted.to] };
}

function firstPlannedFillPoint(group: FillGroup, segments: FillSegment[]): Vec2 | null {
  // The prefix is already shifted. Planning it preserves sorting, split gaps,
  // precision filtering and degenerate-sweep handling without planning the job.
  for (const plan of planFillSweeps({ ...group, segments })) {
    const first = plan.sweep.spans[0];
    const last = plan.sweep.spans[plan.sweep.spans.length - 1];
    if (
      first !== undefined &&
      last !== undefined &&
      expandFillHatchWithRunways([first.start, last.end], plan) !== null
    ) {
      return first.start;
    }
  }
  return null;
}

function firstRasterProcessPoint(group: RasterGroup, options: BuildToolpathOptions): Vec2 | null {
  if (!usableRaster(group) || !(Math.max(1, Math.floor(group.passes)) > 0)) return null;
  const pixelWidthMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  const pixelHeightMm = (group.bounds.maxY - group.bounds.minY) / group.pixelHeight;
  const offset =
    group.bidirectionalScanOffsetMm ??
    offsetForEmittedFeed(options.scanningOffsets ?? [], group.speed);
  let emittedRows = 0;
  for (const { rowIndex, row } of rasterRowsInProviderOrder(group)) {
    const reverse = (group.bidirectional ?? true) && emittedRows % 2 === 1;
    const plans = planRasterRowSweeps({
      row,
      pixelWidthMm,
      overscanMm: group.overscanMm,
      reverse,
      dotWidthCorrectionMm: group.dotWidthCorrectionMm,
      minXWorldMm: group.bounds.minX,
    });
    if (plans.length === 0) continue;
    const y = group.bounds.minY + (rowIndex + 0.5) * pixelHeightMm;
    for (const plan of plans) {
      const point = firstRasterSweepPoint(group, plan, pixelWidthMm, y, reverse, offset);
      if (point !== null) return point;
    }
    emittedRows += 1;
  }
  return null;
}

function usableRaster(group: RasterGroup): boolean {
  return (
    group.pixelWidth > 0 &&
    group.pixelHeight > 0 &&
    (group.rowProvider !== undefined ||
      group.sValues.length >= group.pixelWidth * group.pixelHeight) &&
    group.bounds.maxX > group.bounds.minX &&
    group.bounds.maxY > group.bounds.minY
  );
}

function firstRasterSweepPoint(
  group: RasterGroup,
  plan: RasterRowSweepPlan,
  pixelWidthMm: number,
  y: number,
  reverse: boolean,
  offset: number,
): Vec2 | null {
  const shift = reverse ? -offset : 0;
  let x =
    group.bounds.minX + (reverse ? plan.span.lastX + 1 : plan.span.firstX) * pixelWidthMm + shift;
  for (const run of plan.runs) {
    const target = run.endXWorldMm + shift;
    if (target === x) continue;
    if (run.s > 0) return { x, y };
    x = target;
  }
  return null;
}

function firstCncGroupPoint(passes: ReadonlyArray<CncPass>): Vec2 | null {
  for (const pass of passes) {
    const point = firstCncProcessPoint(pass);
    if (point !== null) return point;
  }
  return null;
}

function firstCncProcessPoint(pass: CncPass): Vec2 | null {
  switch (pass.kind) {
    case 'contour':
      return firstCncContourPoint(pass);
    case 'path3d':
      return pass.points.length >= 2 ? (pass.points[0] ?? null) : null;
    case 'arc':
      return circularArcGeometry(pass).kind === 'ok' || !isCircularArcFullCircle(pass)
        ? pass.start
        : null;
    case 'helical-contour':
      if (!cncHelicalContourCanEmit(pass)) return null;
      return Math.max(1, Math.floor(pass.revolutions)) > 0
        ? pass.start
        : (pass.polyline[0] ?? null);
    default:
      return assertNever(pass, 'CncPass');
  }
}

function firstCncContourPoint(pass: Extract<CncPass, { readonly kind: 'contour' }>): Vec2 | null {
  // A later vertex can choose the contour's shared emission precision,
  // so this one contour must be inspected, but its vertices need not be copied.
  const precision = cncContourEmissionPrecision(pass);
  const point = pass.polyline[0];
  if (precision === null || point === undefined) return null;
  return {
    x: parseGrblCncCoordinate(formatCncContourCoordinate(point.x, precision)),
    y: parseGrblCncCoordinate(formatCncContourCoordinate(point.y, precision)),
  };
}
