import { boundedSplitRunwayLengths } from '../raster/raster-sweep-plan';
import { isEmittableFillSegment } from './fill-emission-resolution';
import { effectiveFillOverscanMm } from './fill-overscan';
import { FILL_GAP_RAPID_THRESHOLD_MM, groupFillScanlines, type FillSweep } from './fill-sweeps';
import type { FillGroup, FillSegment } from './job';
import { shiftAlongTravel } from './scan-offset';

/** Laser-off motion mode used to enter and leave a planned fill sweep. */
export type FillRunwayMotion = 'rapid' | 'feed-matched';

/** One fill sweep plus its executable laser-off entry and exit geometry. */
export type FillSweepPlan = {
  readonly sweep: FillSweep;
  readonly leadInMm: number;
  readonly leadOutMm: number;
  readonly runwayMotion: FillRunwayMotion;
};

/** Bounds a configured feed-matched runway to the shared split-gap threshold. */
export function feedMatchedFillRunwayMm(configuredMm: number): number {
  return Math.min(Math.max(0, configuredMm), FILL_GAP_RAPID_THRESHOLD_MM);
}

/**
 * Generic Scan Line never starts powered motion directly after a rapid.
 * A stored zero predates the universal-runway contract, so use the bounded
 * generic default instead of treating it as an opt-out.
 */
export function genericFeedMatchedFillRunwayMm(configuredMm: number): number {
  const configuredRunwayMm = feedMatchedFillRunwayMm(configuredMm);
  return configuredRunwayMm > 0 ? configuredRunwayMm : FILL_GAP_RAPID_THRESHOLD_MM;
}

/**
 * Plans the exact sweep, scan-offset, and runway geometry consumed by output,
 * preview, Frame bounds, and duration estimation.
 */
export function planFillSweeps(group: FillGroup, scanOffsetMm = 0): FillSweepPlan[] {
  const shiftedSegments = segmentsWithScanOffset(group.segments, scanOffsetMm);
  const segments =
    group.fillRunwayPolicy === 'feed-matched-every-sweep'
      ? shiftedSegments.filter(isEmittableFillSegment)
      : shiftedSegments;
  const scanlines = groupFillScanlines(segments);
  if (group.fillRunwayPolicy === 'raster-full') {
    const runwayMm = Math.max(0, group.overscanMm);
    return scanlines.flatMap((scanline) =>
      scanline.map<FillSweepPlan>((sweep) => ({
        sweep,
        leadInMm: runwayMm,
        leadOutMm: runwayMm,
        runwayMotion: 'feed-matched',
      })),
    );
  }
  if (group.fillRunwayPolicy === 'feed-matched-every-sweep') {
    const runwayMm = genericFeedMatchedFillRunwayMm(group.overscanMm);
    return scanlines.flatMap((scanline) => everySweepFeedMatchedPlans(scanline, runwayMm));
  }
  if (group.fillRunwayPolicy === 'full' || group.fillRunwayPolicy === 'raster-bounded') {
    const runwayMm = Math.max(0, group.overscanMm);
    return scanlines.flatMap((scanline) => feedMatchedPlans(scanline, runwayMm));
  }
  if (!usesFeedMatchedFillRunway(group)) {
    return scanlines.flatMap((scanline) => scanline.map((sweep) => legacyPlan(sweep, group)));
  }
  const runwayMm = feedMatchedFillRunwayMm(group.overscanMm);
  return scanlines.flatMap((scanline) => feedMatchedPlans(scanline, runwayMm));
}

function segmentsWithScanOffset(
  segments: ReadonlyArray<FillSegment>,
  scanOffsetMm: number,
): ReadonlyArray<FillSegment> {
  if (scanOffsetMm === 0) return segments;
  return segments.map((segment) => {
    if (!segment.reverse) return segment;
    const start = segment.polyline[0];
    const end = segment.polyline[1];
    if (start === undefined || end === undefined || segment.polyline.length !== 2) return segment;
    const shifted = shiftAlongTravel(start, end, scanOffsetMm);
    return { ...segment, polyline: [shifted.from, shifted.to] };
  });
}

/** Returns whether a fill group owns feed-matched runway motion. */
export function usesFeedMatchedFillRunway(group: FillGroup): boolean {
  return (
    group.fillRunwayPolicy === 'feed-matched-every-sweep' ||
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
          group.fillRunwayPolicy,
        );
  return { sweep, leadInMm: runwayMm, leadOutMm: runwayMm, runwayMotion: 'rapid' };
}

function feedMatchedPlans(scanline: ReadonlyArray<FillSweep>, runwayMm: number): FillSweepPlan[] {
  return scanline.map<FillSweepPlan>((sweep, index) => {
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
      runwayMotion: 'feed-matched',
    };
  });
}

function everySweepFeedMatchedPlans(
  scanline: ReadonlyArray<FillSweep>,
  runwayMm: number,
): FillSweepPlan[] {
  return scanline.map<FillSweepPlan>((sweep, index) => {
    const previous = scanline[index - 1];
    const next = scanline[index + 1];
    return {
      sweep,
      leadInMm:
        previous === undefined
          ? runwayMm
          : splitSideRunwayMm(runwayMm, splitGapMm(previous, sweep)),
      leadOutMm:
        next === undefined ? runwayMm : splitSideRunwayMm(runwayMm, splitGapMm(sweep, next)),
      runwayMotion: 'feed-matched',
    };
  });
}

function splitGapMm(previous: FillSweep, next: FillSweep): number {
  const previousEnd = previous.spans[previous.spans.length - 1]?.end;
  const nextStart = next.spans[0]?.start;
  if (previousEnd === undefined || nextStart === undefined) return 0;
  return Math.hypot(nextStart.x - previousEnd.x, nextStart.y - previousEnd.y);
}

function splitSideRunwayMm(requestedMm: number, gapMm: number): number {
  return Math.min(Math.max(0, requestedMm), Math.max(0, gapMm) / 2);
}
