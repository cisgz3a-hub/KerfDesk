import type { DeviceProfile } from '../devices';
import { hasGcodeXyMotionAtEmitPrecision } from '../gcode/coordinate-format';
import { planRasterRowSweeps, type RasterRowSweepPlan } from '../raster/raster-sweep-plan';
import { rasterScanFrame, scanToMachine, type RasterScanFrame } from '../raster/raster-scan-frame';
import type { Vec2 } from '../scene';
import { isEmittableCutSegment } from './cut-emission-resolution';
import { firstToolpathProcessPoint } from './first-process-point';
import { expandFillHatchWithRunways } from './fill-runway';
import { planFillSweeps } from './fill-sweep-plan';
import type { FillGroup, Group, Job, RasterGroup } from './job';
import { computeEmittedJobBounds, type JobBounds } from './job-bounds';
import { rasterRowsInProviderOrder } from './raster-rows';
import { offsetForEmittedFeed } from './scan-offset';

/** Bounds for relative cutting-start preferences only. Frame continues to use
 * its full motion envelope. Scan planners supply powered spans without white
 * padding, runways or an allocated full toolpath; CNC reuses represented bounds. */
export function computeJobStartBounds(job: Job, device: DeviceProfile): JobBounds | null {
  let result: JobBounds | null = null;
  for (const group of job.groups) {
    const bounds = groupStartBounds(group, device);
    if (bounds === null) continue;
    result =
      result === null
        ? bounds
        : {
            minX: Math.min(result.minX, bounds.minX),
            minY: Math.min(result.minY, bounds.minY),
            maxX: Math.max(result.maxX, bounds.maxX),
            maxY: Math.max(result.maxY, bounds.maxY),
          };
  }
  return result;
}

function groupStartBounds(group: Group, device: DeviceProfile): JobBounds | null {
  if (group.kind === 'cnc') {
    const passes = group.passes.filter(
      (pass) => firstToolpathProcessPoint({ groups: [{ ...group, passes: [pass] }] }) !== null,
    );
    return computeEmittedJobBounds({ groups: [{ ...group, passes }] }, device);
  }
  if (!(group.power > 0) || !(group.passes > 0)) return null;
  if (group.kind === 'raster') return rasterStartBounds(group, device);
  if (group.kind === 'fill' && group.fillStyle !== 'offset') return fillStartBounds(group, device);
  // Narrow before filtering so offset-fill segments retain their required reverse flag.
  const executableGroup =
    group.kind === 'cut'
      ? { ...group, segments: group.segments.filter(isEmittableCutSegment) }
      : { ...group, segments: group.segments.filter(isEmittableCutSegment) };
  return computeEmittedJobBounds({ groups: [executableGroup] }, device);
}

function boundsCollector() {
  let bounds: JobBounds | null = null;
  return {
    add(from: Vec2, to: Vec2) {
      if (!hasGcodeXyMotionAtEmitPrecision(from, to)) return;
      const minX = Math.min(from.x, to.x),
        maxX = Math.max(from.x, to.x);
      const minY = Math.min(from.y, to.y),
        maxY = Math.max(from.y, to.y);
      bounds =
        bounds === null
          ? { minX, minY, maxX, maxY }
          : {
              minX: Math.min(bounds.minX, minX),
              minY: Math.min(bounds.minY, minY),
              maxX: Math.max(bounds.maxX, maxX),
              maxY: Math.max(bounds.maxY, maxY),
            };
    },
    result: () => bounds,
  };
}

function fillStartBounds(group: FillGroup, device: DeviceProfile): JobBounds | null {
  const bounds = boundsCollector();
  const offset =
    group.bidirectionalScanOffsetMm ?? offsetForEmittedFeed(device.scanningOffsets, group.speed);
  for (const plan of planFillSweeps(group, offset)) {
    const first = plan.sweep.spans[0],
      last = plan.sweep.spans.at(-1);
    if (
      first === undefined ||
      last === undefined ||
      expandFillHatchWithRunways([first.start, last.end], plan) === null
    )
      continue;
    for (const span of plan.sweep.spans) bounds.add(span.start, span.end);
  }
  return bounds.result();
}

function rasterStartBounds(group: RasterGroup, device: DeviceProfile): JobBounds | null {
  if (!hasUsableRasterGeometry(group)) return null;
  const bounds = boundsCollector();
  const pixelWidthMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  const pixelHeightMm = (group.bounds.maxY - group.bounds.minY) / group.pixelHeight;
  const offset =
    group.bidirectionalScanOffsetMm ?? offsetForEmittedFeed(device.scanningOffsets, group.speed);
  const frame = rasterScanFrame(group.scanAngleDeg);
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
      addRasterSweep(bounds, plan, { group, frame, pixelWidthMm, y, reverse, offset });
    }
    emittedRows += 1;
  }
  return bounds.result();
}

function addRasterSweep(
  bounds: ReturnType<typeof boundsCollector>,
  plan: RasterRowSweepPlan,
  context: {
    group: RasterGroup;
    frame: RasterScanFrame;
    pixelWidthMm: number;
    y: number;
    reverse: boolean;
    offset: number;
  },
) {
  const { group, frame, pixelWidthMm, y, reverse, offset } = context;
  const shift = reverse ? -offset : 0;
  let x =
    group.bounds.minX + (reverse ? plan.span.lastX + 1 : plan.span.firstX) * pixelWidthMm + shift;
  for (const run of plan.runs) {
    const next = run.endXWorldMm + shift;
    if (run.s > 0) bounds.add(scanToMachine(frame, { x, y }), scanToMachine(frame, { x: next, y }));
    x = next;
  }
}

function hasUsableRasterGeometry(group: RasterGroup): boolean {
  return (
    group.pixelWidth > 0 &&
    group.pixelHeight > 0 &&
    group.bounds.maxX > group.bounds.minX &&
    group.bounds.maxY > group.bounds.minY &&
    (group.rowProvider !== undefined ||
      group.sValues.length >= group.pixelWidth * group.pixelHeight)
  );
}
