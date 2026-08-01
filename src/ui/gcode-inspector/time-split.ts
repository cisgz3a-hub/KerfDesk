// Where the job's time actually goes, by move kind (ADR-255 stage 13).
//
// The competitive audit noted PrusaSlicer reports time FRACTION per feature,
// while we reported only distances and one total. Distance is the wrong unit
// for that question: a long rapid and a short plunge can take the same time,
// so "60% of the cutting distance" says nothing about where the minutes go.
//
// Uses the planner's per-segment seconds, so the split is as honest as the
// ETA it adds up to.

import type { ProgramTimeModel } from '../../core/gcode-time';
import { SEG_KIND, type GcodeRenderModel } from '../../core/gcode-view';

export type TimeShare = {
  readonly label: string;
  readonly seconds: number;
  /** 0-100, of total MOTION time (dwell is reported separately). */
  readonly percent: number;
};

const KIND_LABEL: ReadonlyArray<{ readonly kind: number; readonly label: string }> = [
  { kind: SEG_KIND.cut, label: 'Cutting' },
  { kind: SEG_KIND.plunge, label: 'Plunging' },
  { kind: SEG_KIND.travel, label: 'Traversing' },
  { kind: SEG_KIND.retract, label: 'Retracting' },
];

/**
 * Time share per move kind, largest first, omitting kinds the program never
 * uses. Empty when there is no motion to divide up.
 */
export function timeSplit(
  model: GcodeRenderModel,
  time: ProgramTimeModel,
): ReadonlyArray<TimeShare> {
  if (time.motionSeconds <= 0) return [];
  const seconds = new Map<number, number>();
  for (let index = 0; index < model.segmentCount; index += 1) {
    const kind = model.segKind[index] ?? SEG_KIND.travel;
    seconds.set(kind, (seconds.get(kind) ?? 0) + (time.segSeconds[index] ?? 0));
  }
  return KIND_LABEL.map((entry) => ({
    label: entry.label,
    seconds: seconds.get(entry.kind) ?? 0,
    percent: ((seconds.get(entry.kind) ?? 0) / time.motionSeconds) * 100,
  }))
    .filter((share) => share.seconds > 0)
    .sort((left, right) => right.seconds - left.seconds);
}
