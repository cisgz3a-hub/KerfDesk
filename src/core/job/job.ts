// Job — the intermediate representation that sits between Scene and G-code.
// Scene → Job is the compile step (core/job/compile-job.ts). Job → Plan is the
// optimize step (core/plan, no-op in MVP Phase A). Plan → string is the
// strategy step (core/output, GrblStrategy in Phase A).
//
// Job carries one CutGroup per output-enabled layer. Each group has the
// polylines to cut, already in machine coordinates (origin transform applied),
// at the layer's power/speed/passes.

import type { Vec2 } from '../scene';

export type CutSegment = {
  // Polyline in mm, in machine coordinates (post-origin-transform). For a
  // closed segment, the last point equals the first by construction.
  readonly polyline: ReadonlyArray<Vec2>;
  readonly closed: boolean;
};

export type CutGroup = {
  readonly layerId: string;
  readonly color: string;
  readonly power: number; // 0..100 (percent)
  readonly speed: number; // mm/min; already capped to device.maxFeed
  readonly passes: number; // integer ≥ 1
  readonly segments: ReadonlyArray<CutSegment>;
};

export type Job = {
  readonly groups: ReadonlyArray<CutGroup>;
};

export const EMPTY_JOB: Job = { groups: [] };
