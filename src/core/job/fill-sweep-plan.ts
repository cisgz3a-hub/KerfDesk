import { boundedSplitRunwayLengths } from '../raster/raster-sweep-plan';
import { effectiveFillOverscanMm } from './fill-overscan';
import { FILL_GAP_RAPID_THRESHOLD_MM, groupFillScanlines, type FillSweep } from './fill-sweeps';
import type { FillGroup } from './job';

export type FillRunwayMotion = 'rapid' | 'feed-matched';

export type FillSweepPlan = {
  readonly sweep: FillSweep;
  readonly leadInMm: number;
  readonly leadOutMm: number;
  readonly runwayMotion: FillRunwayMotion;
};

export function feedMatchedFillRunwayMm(configuredMm: number): number {
  return Math.min(Math.max(0, configuredMm), FILL_GAP_RAPID_THRESHOLD_MM);
}

export function planFillSweeps(group: FillGroup): FillSweepPlan[] {
  const scanlines = groupFillScanlines(group.segments);
  if (group.fillRunwayPolicy === 'raster-full') {
    const runwayMm = Math.max(0, group.overscanMm);
    return scanlines.flatMap((scanline) =>
      scanline.map((sweep) => ({
        sweep,
        leadInMm: runwayMm,
        leadOutMm: runwayMm,
        runwayMotion: 'feed-matched' as const,
      })),
    );
  }
  if (group.fillRunwayPolicy === 'full' || group.fillRunwayPolicy === 'raster-bounded') {
    const runwayMm = Math.max(0, group.overscanMm);
    return scanlines.flatMap((scanline) => feedMatchedPlans(scanline, runwayMm));
  }
  if (!usesFeedMatchedFillEntry(group)) {
    return scanlines.flatMap((scanline) => scanline.map((sweep) => legacyPlan(sweep, group)));
  }
  const runwayMm = feedMatchedFillRunwayMm(group.overscanMm);
  return scanlines.flatMap((scanline) => feedMatchedPlans(scanline, runwayMm));
}

export function usesFeedMatchedFillEntry(group: FillGroup): boolean {
  return group.fillRunwayPolicy === 'feed-matched-entry';
}

function legacyPlan(sweep: FillSweep, group: FillGroup): FillSweepPlan {
  const first = sweep.spans[0];
  const last = sweep.spans[sweep.spans.length - 1];
  const runwayMm =
    first === undefined || last === undefined
      ? 0
      : effectiveFillOverscanMm(
          [first.start, last.end],
          group.overscanMm,
          group.fillStyle,
          group.islandMotionPolicy,
          group.fillRunwayPolicy,
        );
  return { sweep, leadInMm: runwayMm, leadOutMm: runwayMm, runwayMotion: 'rapid' };
}

function feedMatchedPlans(scanline: ReadonlyArray<FillSweep>, runwayMm: number): FillSweepPlan[] {
  return scanline.map((sweep, index) => {
    const previous = scanline[index - 1];
    const previousEnd = previous?.spans[previous.spans.length - 1]?.end;
    const currentStart = sweep.spans[0]?.start;
    const gapBeforeMm =
      previousEnd === undefined || currentStart === undefined
        ? runwayMm
        : Math.hypot(currentStart.x - previousEnd.x, currentStart.y - previousEnd.y);
    const runwayLengths = boundedSplitRunwayLengths({
      index,
      count: scanline.length,
      requestedMm: runwayMm,
      gapBeforeMm,
    });
    return {
      sweep,
      ...runwayLengths,
      runwayMotion: 'feed-matched' as const,
    };
  });
}
