// Where the job's time actually goes, by move kind (ADR-255 stage 13).
//
// The competitive audit noted PrusaSlicer reports time FRACTION per feature,
// while we reported only distances and one total. Distance is the wrong unit
// for that question: a long rapid and a short plunge can take the same time,
// so "60% of the cutting distance" says nothing about where the minutes go.
//
// Uses the planner's seconds, summed per kind in the parse worker (ADR-485),
// so the split is as honest as the ETA it adds up to.

import { SEG_KIND } from '../../core/gcode-view';
import type { InspectorProgramTime } from './inspector-model';

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
  time: Pick<InspectorProgramTime, 'kindSeconds' | 'motionSeconds'>,
): ReadonlyArray<TimeShare> {
  if (time.motionSeconds <= 0) return [];
  return KIND_LABEL.map((entry) => {
    const seconds = time.kindSeconds[entry.kind] ?? 0;
    return { label: entry.label, seconds, percent: (seconds / time.motionSeconds) * 100 };
  })
    .filter((share) => share.seconds > 0)
    .sort((left, right) => right.seconds - left.seconds);
}
