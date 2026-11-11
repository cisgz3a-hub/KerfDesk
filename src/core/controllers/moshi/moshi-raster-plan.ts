// The moves a Moshi raster program commands for an Image group (ADR-705,
// Amendment 2). MeerK40t runs a raster as one raster-mode program whose moves
// are all horizontal or vertical (meerk40t/moshi/driver.py `_goto_absolute`
// L817-845 at d511944e: a raster step that is neither is dropped) and
// supports only horizontal scans (device.py `get_raster_instructions`
// L533-545 marks the diagonal, spiral and greedy orders unsupported).
//
// Each row's geometry comes from the planner the G-code raster uses
// (planRasterRowSweeps, as emit-raster.ts and emit-raster-sweep.ts walk it),
// so a Moshi row burns exactly where a G-code row does: the same ink islands,
// laser-off runways up to the overscan that end at the first dark pixel's
// edge (rolling audit C2 D1-P1-1), the Dot width correction, and every row
// moved half the bidirectional scan offset along its travel (D1-P1-2; ADR-052
// Amendment 2). Each row is a
// vertical move to the row, a horizontal move to its runway start, then
// horizontal moves and cuts. A Moshi has no power control: every pixel above
// 0 burns at the machine's dial power.

import type { DeviceProfile } from '../../devices';
import type { RasterGroup } from '../../job';
import { offsetForSpeed, rasterRowShiftX } from '../../job/scan-offset';
import type { RasterPowerValues } from '../../raster/raster-power-values';
import { planRasterRowSweeps, type RasterRowSweepPlan } from '../../raster/raster-sweep-plan';
import { mmToMils, type MoshiPoint, type MoshiStep } from './moshi-units';

export type MoshiRasterPlan = {
  readonly steps: ReadonlyArray<MoshiStep>;
  /** More than one burning level: grey tones the board burns as one. */
  readonly greyLevels: boolean;
};

type RowContext = {
  readonly group: RasterGroup;
  readonly pixelWidthMm: number;
  readonly scanOffsetMm: number;
  readonly dotWidthCorrectionMm: number;
};

/** The scan offset a reversed row gets, resolved as the G-code strategy does
 *  (grbl-strategy.ts): the layer's own value, else the machine's table. */
export function moshiRasterScanOffsetMm(group: RasterGroup, device: DeviceProfile): number {
  return group.bidirectionalScanOffsetMm ?? offsetForSpeed(device.scanningOffsets, group.speed);
}

export function planRasterGroupSteps(group: RasterGroup, device: DeviceProfile): MoshiRasterPlan {
  const steps: MoshiStep[] = [];
  const pixelHeightMm = (group.bounds.maxY - group.bounds.minY) / group.pixelHeight;
  const context: RowContext = {
    group,
    pixelWidthMm: (group.bounds.maxX - group.bounds.minX) / group.pixelWidth,
    scanOffsetMm: moshiRasterScanOffsetMm(group, device),
    dotWidthCorrectionMm: Math.max(0, group.dotWidthCorrectionMm),
  };
  const levels = new Set<number>();
  let head: MoshiPoint | null = null;
  for (let pass = 0; pass < Math.max(1, Math.trunc(group.passes)); pass += 1) {
    let rowCount = 0;
    for (const { rowIndex, row } of rowsInOrder(group)) {
      const reverse = (group.bidirectional ?? true) && rowCount % 2 === 1;
      const sweeps = planRasterRowSweeps({
        row,
        pixelWidthMm: context.pixelWidthMm,
        overscanMm: group.overscanMm,
        reverse,
        dotWidthCorrectionMm: context.dotWidthCorrectionMm,
        minXWorldMm: group.bounds.minX,
      });
      if (sweeps.length === 0) continue;
      const y = mmToMils(group.bounds.minY + (rowIndex + 0.5) * pixelHeightMm);
      for (const sweep of sweeps) head = planSweep(steps, head, y, reverse, sweep, context, levels);
      rowCount += 1;
    }
  }
  return { steps, greyLevels: levels.size > 1 };
}

function* rowsInOrder(
  group: RasterGroup,
): Generator<{ readonly rowIndex: number; readonly row: RasterPowerValues }> {
  const width = group.pixelWidth;
  for (let sourceY = 0; sourceY < group.pixelHeight; sourceY += 1) {
    const row =
      group.rowProvider === undefined
        ? group.sValues.subarray(sourceY * width, (sourceY + 1) * width)
        : group.rowProvider(sourceY);
    const rowIndex =
      group.rowProviderOrder === 'descending-y' ? group.pixelHeight - 1 - sourceY : sourceY;
    yield { rowIndex, row };
  }
}

/** One sweep: to its runway start (vertically to the row first, so every
 *  raster move stays on one axis), the runway up to the first dark pixel's
 *  edge, the planned runs, and the exit runway, all laser off but the burns. */
function planSweep(
  steps: MoshiStep[],
  head: MoshiPoint | null,
  y: number,
  reverse: boolean,
  sweep: RasterRowSweepPlan,
  context: RowContext,
  levels: Set<number>,
): MoshiPoint {
  const { group, pixelWidthMm } = context;
  // Every row moves half the offset along its own travel (ADR-052 Amd 2), as
  // emit-raster-sweep.ts does: forward rows one way, reversed rows the other.
  const shift = rasterRowShiftX(context.scanOffsetMm, reverse, context.group.bidirectional ?? true);
  const x = (worldMm: number): number => mmToMils(Math.max(0, worldMm + shift));
  const push = (atX: number, cut: boolean): void => {
    const last = steps[steps.length - 1];
    if (last !== undefined && last.x === atX && last.y === y) return;
    steps.push({ x: atX, y, cut });
  };
  const edges = sweepEdges(group, pixelWidthMm, sweep, reverse);
  if (head !== null && head.y !== y) steps.push({ x: head.x, y, cut: false });
  push(x(edges.startX), false);
  // The runway ends where the first dark pixel starts; the burn begins there.
  push(x(edges.inkX), false);
  for (const run of sweep.runs) {
    if (run.s > 0) levels.add(run.s);
    push(x(run.endXWorldMm), run.s > 0);
  }
  push(x(edges.endX), false);
  const last = steps[steps.length - 1];
  return { x: last?.x ?? x(edges.endX), y };
}

/** Where a sweep starts and ends (its runways, or points shared with the
 *  neighbouring island) and where its ink starts, in world mm along X, as
 *  emit-raster-sweep.ts sweepExtents computes them. */
function sweepEdges(
  group: RasterGroup,
  pixelWidthMm: number,
  sweep: RasterRowSweepPlan,
  reverse: boolean,
): { readonly startX: number; readonly inkX: number; readonly endX: number } {
  const activeStartX = group.bounds.minX + sweep.span.firstX * pixelWidthMm;
  const activeEndX = group.bounds.minX + (sweep.span.lastX + 1) * pixelWidthMm;
  return {
    startX:
      sweep.sharedLeadStartXWorldMm ??
      (reverse ? activeEndX + sweep.leadInMm : activeStartX - sweep.leadInMm),
    inkX: reverse ? activeEndX : activeStartX,
    endX:
      sweep.sharedLeadEndXWorldMm ??
      (reverse ? activeStartX - sweep.leadOutMm : activeEndX + sweep.leadOutMm),
  };
}
