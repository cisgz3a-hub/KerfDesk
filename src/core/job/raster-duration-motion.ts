import {
  planRasterRowSweeps,
  rasterControllerCoordinateMm,
  type RasterRowSweepPlan,
  type RasterSweepRun,
} from '../raster/raster-sweep-plan';
import type { Vec2 } from '../scene';
import type { RasterGroup } from './job';
import { rasterRowsInProviderOrder } from './raster-rows';
import { offsetForSpeed, type ScanOffsetPoint } from './scan-offset';

export type RasterDurationMotion = {
  readonly kind: 'cut' | 'feed-travel' | 'seek';
  readonly from: Vec2;
  readonly to: Vec2;
};

export function* rasterDurationMotion(
  group: RasterGroup,
  initialCursor: Vec2,
  scanningOffsets: ReadonlyArray<ScanOffsetPoint>,
): Generator<RasterDurationMotion> {
  const geometry = rasterGeometry(group);
  if (geometry === null) return;
  const scanOffsetMm =
    group.bidirectionalScanOffsetMm ?? offsetForSpeed(scanningOffsets, group.speed);
  const passes = Math.max(1, Math.floor(group.passes));
  let cursor = initialCursor;
  for (let pass = 0; pass < passes; pass += 1) {
    for (const motion of rasterPassDurationMotion(group, cursor, geometry, scanOffsetMm)) {
      yield motion;
      cursor = motion.to;
    }
  }
}

type RasterGeometry = {
  readonly pixelWidthMm: number;
  readonly pixelHeightMm: number;
};

function rasterGeometry(group: RasterGroup): RasterGeometry | null {
  if (group.pixelWidth <= 0 || group.pixelHeight <= 0) return null;
  const pixelWidthMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  const pixelHeightMm = (group.bounds.maxY - group.bounds.minY) / group.pixelHeight;
  if (pixelWidthMm <= 0 || pixelHeightMm <= 0) return null;
  return { pixelWidthMm, pixelHeightMm };
}

function* rasterPassDurationMotion(
  group: RasterGroup,
  initialCursor: Vec2,
  geometry: RasterGeometry,
  scanOffsetMm: number,
): Generator<RasterDurationMotion> {
  let cursor = initialCursor;
  let emittedRowCount = 0;
  for (const { rowIndex, row } of rasterRowsInProviderOrder(group)) {
    const reverse = (group.bidirectional ?? true) && emittedRowCount % 2 === 1;
    const plans = planRasterRowSweeps({
      row,
      pixelWidthMm: geometry.pixelWidthMm,
      overscanMm: group.overscanMm,
      reverse,
      dotWidthCorrectionMm: group.dotWidthCorrectionMm,
      minXWorldMm: group.bounds.minX,
    });
    if (plans.length === 0) continue;
    const worldY = group.bounds.minY + (rowIndex + 0.5) * geometry.pixelHeightMm;
    for (const plan of plans) {
      const motion = rasterSweepMotion(group, plan, worldY, reverse, scanOffsetMm);
      yield { kind: 'seek', from: cursor, to: motion.leadStart };
      yield { kind: 'feed-travel', from: motion.leadStart, to: motion.activeEntry };
      for (const run of motion.runs) yield run;
      yield { kind: 'feed-travel', from: motion.runExit, to: motion.leadEnd };
      cursor = motion.leadEnd;
    }
    emittedRowCount += 1;
  }
}

type RasterSweepMotion = {
  readonly leadStart: Vec2;
  readonly activeEntry: Vec2;
  readonly runs: ReadonlyArray<RasterDurationMotion>;
  readonly runExit: Vec2;
  readonly leadEnd: Vec2;
};

function rasterSweepMotion(
  group: RasterGroup,
  plan: RasterRowSweepPlan,
  y: number,
  reverse: boolean,
  scanOffsetMm: number,
): RasterSweepMotion {
  const pixelWidthMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  const activeStartX = group.bounds.minX + plan.span.firstX * pixelWidthMm;
  const activeEndX = group.bounds.minX + (plan.span.lastX + 1) * pixelWidthMm;
  const rowShiftX = reverse ? -scanOffsetMm : 0;
  const activeEntry = point((reverse ? activeEndX : activeStartX) + rowShiftX, y);
  const activeExit = point((reverse ? activeStartX : activeEndX) + rowShiftX, y);
  const durationRuns = rasterSweepDurationRuns(plan.runs, activeEntry, rowShiftX, y);
  return {
    leadStart: point(activeEntry.x + (reverse ? plan.leadInMm : -plan.leadInMm), y),
    activeEntry,
    runs: durationRuns.motions,
    runExit: durationRuns.exit,
    leadEnd: point(activeExit.x + (reverse ? -plan.leadOutMm : plan.leadOutMm), y),
  };
}

function rasterSweepDurationRuns(
  runs: ReadonlyArray<RasterSweepRun>,
  initialHead: Vec2,
  rowShiftX: number,
  y: number,
): { readonly motions: RasterDurationMotion[]; readonly exit: Vec2 } {
  const motions: RasterDurationMotion[] = [];
  let head = initialHead;
  let controllerHeadX = rasterControllerCoordinateMm(head.x);
  for (const run of runs) {
    const target = point(run.endXWorldMm + rowShiftX, y);
    const controllerTargetX = rasterControllerCoordinateMm(target.x);
    if (run.s > 0 && controllerTargetX === controllerHeadX) continue;
    motions.push({
      kind: run.s > 0 ? 'cut' : 'feed-travel',
      from: head,
      to: target,
    });
    head = target;
    controllerHeadX = controllerTargetX;
  }
  return { motions, exit: head };
}

function point(x: number, y: number): Vec2 {
  return { x, y };
}
