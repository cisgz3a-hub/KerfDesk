// Writer 2 of the painted pass (ADR-341 Amendment 3) replays a selected sweep
// only where it matters. A sweep is one straight scan: an optional dark
// lead-in, the source's burns, an optional dark lead-out. The window runs from
// the first painted point less the sweep's own lead-in to the last painted
// point plus its own lead-out, so the head crosses every painted point at the
// speed the original job reached there. A side with no lead-in (or lead-out)
// in the source keeps the full sweep on that side: the original passed the
// painted point at whatever speed it had built from the sweep's start, and a
// shorter approach would change that speed.

import { partitionBrushPower } from './brush-partition';
import type { BrushIndex } from './brush-index';
import { selectedPower } from './program-writer';
import { visitLaserSecondPassSource, type SourceSegment } from './source';
import type { LaserSecondPassSelection } from './types';

/** Path-length window, in mm from the sweep's first point, that writer 2 replays. */
export type SweepWindow = { readonly startMm: number; readonly endMm: number };

type SweepMeasure = {
  readonly group: number;
  lengthMm: number;
  /** Path length where the source first and last fires; -1 before any burn. */
  firstBurnMm: number;
  lastBurnMm: number;
  /** Path length of the first and last selected (painted) power; -1 if none. */
  firstPaintedMm: number;
  lastPaintedMm: number;
};

export function segmentLengthMm(segment: SourceSegment): number {
  return Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
}

/** First pass: the replay window of every sweep that carries painted power. */
export function measureSweepWindows(
  sourceGcode: string,
  selection: LaserSecondPassSelection,
  index: BrushIndex,
): ReadonlyMap<number, SweepWindow> {
  const windows = new Map<number, SweepWindow>();
  const open: { sweep: SweepMeasure | null } = { sweep: null };
  visitLaserSecondPassSource(sourceGcode, selection.initialPosition, (segment) => {
    if (segment.rapid) return;
    if (open.sweep === null || open.sweep.group !== segment.group) {
      closeSweep(open.sweep, windows);
      open.sweep = {
        group: segment.group,
        lengthMm: 0,
        firstBurnMm: -1,
        lastBurnMm: -1,
        firstPaintedMm: -1,
        lastPaintedMm: -1,
      };
    }
    measureSegment(open.sweep, segment, selection, index);
  });
  closeSweep(open.sweep, windows);
  return windows;
}

function measureSegment(
  sweep: SweepMeasure,
  segment: SourceSegment,
  selection: LaserSecondPassSelection,
  index: BrushIndex,
): void {
  const length = segmentLengthMm(segment);
  const start = sweep.lengthMm;
  sweep.lengthMm += length;
  if (segment.power <= 0) return;
  if (sweep.firstBurnMm < 0) sweep.firstBurnMm = start;
  sweep.lastBurnMm = start + length;
  for (const interval of partitionBrushPower(segment, index, selection.strokes)) {
    if (selectedPower(segment.power, interval.scale, selection.maxPowerS) <= 0) continue;
    if (sweep.firstPaintedMm < 0) sweep.firstPaintedMm = start + interval.start * length;
    sweep.lastPaintedMm = start + interval.end * length;
  }
}

function closeSweep(sweep: SweepMeasure | null, windows: Map<number, SweepWindow>): void {
  if (sweep === null || sweep.firstPaintedMm < 0) return;
  const leadInMm = sweep.firstBurnMm;
  const leadOutMm = sweep.lengthMm - sweep.lastBurnMm;
  windows.set(sweep.group, {
    startMm: leadInMm > 0 ? Math.max(0, sweep.firstPaintedMm - leadInMm) : 0,
    endMm:
      leadOutMm > 0 ? Math.min(sweep.lengthMm, sweep.lastPaintedMm + leadOutMm) : sweep.lengthMm,
  });
}

/** Parameter of `distanceMm` along a segment that starts `startMm` into its
 * sweep, clamped to the segment. */
export function clampedParameter(distanceMm: number, startMm: number, lengthMm: number): number {
  return Math.min(1, Math.max(0, (distanceMm - startMm) / lengthMm));
}
