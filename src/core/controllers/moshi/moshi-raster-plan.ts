// The moves a Moshi raster program commands for an Image group (ADR-705).
// MeerK40t runs a raster as one raster-mode program whose moves are all
// horizontal or vertical (meerk40t/moshi/driver.py `_goto_absolute` L817-845
// at d511944e: a raster step that is neither is dropped) and supports only
// horizontal scans (device.py `get_raster_instructions` L533-545 marks the
// diagonal, spiral and greedy orders unsupported). So each row here is a
// vertical move to the row, a horizontal move to its entry runway, then
// horizontal cuts across dark pixels and moves across light ones. A Moshi has
// no power control: every pixel above 0 burns at the machine's dial power.

import type { RasterGroup } from '../../job';
import type { RasterPowerValues } from '../../raster/raster-power-values';
import { mmToMils, type MoshiPoint, type MoshiStep } from './moshi-units';

export type MoshiRasterPlan = {
  readonly steps: ReadonlyArray<MoshiStep>;
  /** More than one burning level: grey tones the board burns as one. */
  readonly greyLevels: boolean;
};

type Run = { readonly endPixel: number; readonly on: boolean };

export function planRasterGroupSteps(group: RasterGroup): MoshiRasterPlan {
  const steps: MoshiStep[] = [];
  const pixelWidthMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  const pixelHeightMm = (group.bounds.maxY - group.bounds.minY) / group.pixelHeight;
  const runwayMm = Math.max(0, group.overscanMm);
  const passes = Math.max(1, Math.trunc(group.passes));
  const levels = new Set<number>();
  let head: MoshiPoint | null = null;
  for (let pass = 0; pass < passes; pass += 1) {
    let rowCount = 0;
    for (const { rowIndex, row } of rowsInOrder(group)) {
      const runs = rowRuns(row, levels);
      if (runs === null) continue;
      const reverse = (group.bidirectional ?? true) && rowCount % 2 === 1;
      const y = mmToMils(group.bounds.minY + (rowIndex + 0.5) * pixelHeightMm);
      const edge = (pixel: number): number => group.bounds.minX + pixel * pixelWidthMm;
      head = planRow(steps, head, {
        y,
        reverse,
        entryX: mmToMils(
          Math.max(0, reverse ? edge(runs.last) + runwayMm : edge(runs.first) - runwayMm),
        ),
        exitX: mmToMils(
          Math.max(0, reverse ? edge(runs.first) - runwayMm : edge(runs.last) + runwayMm),
        ),
        startX: mmToMils(edge(runs.first)),
        runs: runs.runs.map((run) => ({ x: mmToMils(edge(run.endPixel)), on: run.on })),
      });
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

/** The left-to-right on/off runs between the first and last dark pixel, as
 *  pixel edges: `endPixel` is the edge each run ends at. Null for a blank row. */
function rowRuns(
  row: RasterPowerValues,
  levels: Set<number>,
): { first: number; last: number; runs: Run[] } | null {
  let first = -1;
  let last = -1;
  for (let x = 0; x < row.length; x += 1) {
    const value = row[x] ?? 0;
    if (!(value > 0)) continue;
    levels.add(value);
    if (first === -1) first = x;
    last = x + 1;
  }
  if (first === -1) return null;
  const runs: Run[] = [];
  let on = true;
  for (let x = first + 1; x <= last; x += 1) {
    const next = x < last && (row[x] ?? 0) > 0;
    if (x === last || next !== on) {
      runs.push({ endPixel: x, on });
      on = next;
    }
  }
  return { first, last, runs };
}

type RowPlan = {
  readonly y: number;
  readonly reverse: boolean;
  readonly entryX: number;
  readonly exitX: number;
  /** The left edge of the first dark pixel. */
  readonly startX: number;
  readonly runs: ReadonlyArray<{ readonly x: number; readonly on: boolean }>;
};

function planRow(steps: MoshiStep[], head: MoshiPoint | null, plan: RowPlan): MoshiPoint {
  const push = (x: number, y: number, cut: boolean): void => {
    const last = steps[steps.length - 1];
    if (last !== undefined && last.x === x && last.y === y) return;
    steps.push({ x, y, cut });
  };
  if (head === null) push(plan.entryX, plan.y, false);
  else {
    // Vertical to the row first, then along it: every raster move is on one axis.
    push(head.x, plan.y, false);
    push(plan.entryX, plan.y, false);
  }
  const runs = plan.reverse ? reversedRuns(plan.runs, plan.startX) : plan.runs;
  for (const run of runs) push(run.x, plan.y, run.on);
  push(plan.exitX, plan.y, false);
  return { x: plan.exitX, y: plan.y };
}

/** The same runs walked right to left: each ends where the run to its left
 *  ends, and the leftmost run ends at the row's start edge. */
function reversedRuns(
  runs: ReadonlyArray<{ readonly x: number; readonly on: boolean }>,
  startX: number,
): ReadonlyArray<{ readonly x: number; readonly on: boolean }> {
  const out: { x: number; on: boolean }[] = [];
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = runs[i];
    if (run === undefined) continue;
    out.push({ x: runs[i - 1]?.x ?? startX, on: run.on });
  }
  return out;
}
