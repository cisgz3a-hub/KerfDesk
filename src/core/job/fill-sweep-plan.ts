import { boundedSplitRunwayLengths } from '../raster/raster-sweep-plan';
import type { Vec2 } from '../scene';
import { DEFAULT_OVERSCAN_MM, MAX_FILL_OVERSCAN_MM } from './compile-job-defaults';
import { isEmittableFillSegment } from './fill-emission-resolution';
import { effectiveFillOverscanMm } from './fill-overscan';
import type { FillRunwayLengths } from './fill-runway';
import { FILL_GAP_RAPID_THRESHOLD_MM, groupFillScanlines, type FillSweep } from './fill-sweeps';
import type { FillGroup, FillSegment } from './job';
import { shiftAlongTravel } from './scan-offset';

/** Laser-off motion mode used to enter and leave a planned fill sweep. */
export type FillRunwayMotion = 'rapid' | 'feed-matched';

/** One fill sweep plus its executable laser-off entry and exit geometry. */
export type FillSweepPlan = FillRunwayLengths & {
  readonly sweep: FillSweep;
  readonly runwayMotion: FillRunwayMotion;
};

/**
 * Bounds a configured feed-matched runway to the shared split-gap threshold.
 * This is ADR-234's 4040-safe Scan Line entry length (ADR-239 contour entries
 * reuse it), chosen to keep those runways within ADR-035's 5 mm blank-feed cap.
 */
export function feedMatchedFillRunwayMm(configuredMm: number): number {
  return Math.min(Math.max(0, configuredMm), FILL_GAP_RAPID_THRESHOLD_MM);
}

/**
 * Generic Scan Line never starts powered motion directly after a rapid.
 * A stored zero predates the universal-runway contract, so use the generic
 * default instead of treating it as an opt-out. A positive value applies in
 * full up to MAX_FILL_OVERSCAN_MM, the Overscan field's own maximum: split
 * sweeps already share their gap without overlap, and the 4040 bound above is
 * that profile's decision, not a geometric limit.
 */
export function genericFeedMatchedFillRunwayMm(configuredMm: number): number {
  return Number.isFinite(configuredMm) && configuredMm > 0
    ? Math.min(configuredMm, MAX_FILL_OVERSCAN_MM)
    : DEFAULT_OVERSCAN_MM;
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
    return scanlines.flatMap((scanline) => feedMatchedPlans(scanline, runwayMm));
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
  const joins = fillSplitRunwayJoins(scanline, runwayMm);
  return scanline.map<FillSweepPlan>((sweep, index) => {
    const previous = scanline[index - 1];
    const next = scanline[index + 1];
    const sharedLeadStart = joins[index - 1];
    const sharedLeadEnd = joins[index];
    const runwayLengths = boundedSplitRunwayLengths({
      index,
      count: scanline.length,
      requestedMm: runwayMm,
      gapBeforeMm: previous === undefined ? runwayMm : splitGapMm(previous, sweep),
      gapAfterMm: next === undefined ? runwayMm : splitGapMm(sweep, next),
    });
    return {
      sweep,
      ...runwayLengths,
      ...(sharedLeadStart === undefined ? {} : { sharedLeadStart }),
      ...(sharedLeadEnd === undefined ? {} : { sharedLeadEnd }),
      runwayMotion: 'feed-matched',
    };
  });
}

function fillSplitRunwayJoins(
  scanline: ReadonlyArray<FillSweep>,
  runwayMm: number,
): ReadonlyArray<Vec2 | undefined> {
  return scanline.slice(1).map((next, index) => {
    const previous = scanline[index];
    if (previous === undefined || runwayMm <= 0 || splitGapMm(previous, next) > 2 * runwayMm) {
      return undefined;
    }
    const from = previous.spans[previous.spans.length - 1]?.end;
    const to = next.spans[0]?.start;
    if (from === undefined || to === undefined) return undefined;
    // The shifted/rotated world endpoints define one shared midpoint. Reusing
    // it avoids separate +/- expansions rounding to different controller points.
    return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  });
}

function splitGapMm(previous: FillSweep, next: FillSweep): number {
  const previousEnd = previous.spans[previous.spans.length - 1]?.end;
  const nextStart = next.spans[0]?.start;
  if (previousEnd === undefined || nextStart === undefined) return 0;
  return Math.hypot(nextStart.x - previousEnd.x, nextStart.y - previousEnd.y);
}
