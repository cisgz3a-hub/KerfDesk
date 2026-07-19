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
  if (!usesFeedMatchedFillEntry(group)) {
    return scanlines.flatMap((scanline) => scanline.map((sweep) => legacyPlan(sweep, group)));
  }
  const runwayMm = feedMatchedFillRunwayMm(group.overscanMm);
  return scanlines.flatMap((scanline) => feedMatchedPlans(scanline, runwayMm));
}

export function usesFeedMatchedFillEntry(group: FillGroup): boolean {
  return (
    (group.fillStyle ?? 'scanline') === 'scanline' &&
    group.fillRunwayPolicy === 'feed-matched-entry'
  );
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
        );
  return { sweep, leadInMm: runwayMm, leadOutMm: runwayMm, runwayMotion: 'rapid' };
}

function feedMatchedPlans(scanline: ReadonlyArray<FillSweep>, runwayMm: number): FillSweepPlan[] {
  return scanline.map((sweep, index) => ({
    sweep,
    leadInMm: runwayMm,
    // Internal split boundaries own one entry runway only. This leaves a
    // monotonic G0 remainder before the next G1/S0 lead-in and cannot overlap.
    leadOutMm: index === scanline.length - 1 ? runwayMm : 0,
    runwayMotion: 'feed-matched',
  }));
}
