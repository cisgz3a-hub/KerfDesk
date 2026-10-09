// Inputs and result of the production V-carve planner (vcarveMedialPasses,
// ADR-285). The retired offset-ring ladder keeps the same shapes as its test
// reference (vcarve-ladder.test-support.ts).

import type { CncPass } from '../job';
import type { CncTool } from '../scene';
import type { VCarveSourceBoundaryCoverage } from './vcarve-source-boundary-coverage';

export type VCarveOptions = {
  readonly tool: CncTool;
  readonly maxDepthMm: number;
  readonly depthPerPassMm: number;
  readonly resolutionMm: number; // 0 = auto
  // Opt-in maximum along-contour entry angle. Absent preserves the legacy
  // stepped-plunge program for saved jobs whose cutter entry data is unknown.
  readonly rampAngleDeg?: number;
};

export type VCarveLadder = {
  readonly sourceBoundaryCoverage?: VCarveSourceBoundaryCoverage;
  readonly passes: ReadonlyArray<CncPass>;
  // True when the ring ladder stopped on an offset-engine failure rather than
  // on reaching the medial axis: the carve is shallower and narrower than the
  // artwork asks for. Reported to Job Review, never a refusal (rule 7).
  readonly offsetFailed: boolean;
  // A configured ramp that could not be planned and therefore used the legacy
  // stepped entry. Reported to Job Review, never a refusal (rule 7).
  readonly entryIssue: string | null;
  // True when some artwork is thinner than even the fine detail pitch can
  // carve (< 2 × THIN_DETAIL_RESOLUTION_MM wide): that material stays uncut.
  // Also Job Review material, never a refusal (rule 7).
  readonly thinResidual: boolean;
  // True when planning could not represent all requested material/profile at
  // valid settings: a ladder hit its ring budget, the depth-clamp footprint
  // demands a pitch finer than the coverage floor, or XYZ emission precision
  // cannot retain the certified detail-depth tolerance. Reported as the
  // pass-limit advisory, never a refusal (rule 7).
  readonly passLimited: boolean;
};
