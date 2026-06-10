// prepare-output — the single source of truth for turning a Project into the
// machine Job that everything downstream reasons about: Save, Start, the canvas
// Preview, and the live Estimate. Before this, the Preview built its toolpath
// from RAW compileJob (no optimize, no job-origin) while Save/Start emitted from
// the OPTIMIZED job, so the operator could approve one path order in the preview
// and burn another (roadmap P1-C). prepareOutput runs the identical pipeline for
// every consumer: pre-emit budget guard -> compile -> optional job-origin ->
// optimize. Pure: no clock, no random, no I/O.

import {
  applyJobOrigin,
  compileJob,
  jobOriginOffset,
  optimizePaths,
  type Job,
  type JobOriginPlacement,
} from '../../core/job';
import { runPreEmitPreflight, type PreflightResult } from '../../core/preflight';
import type { Project, Vec2 } from '../../core/scene';

export type PrepareOutputOptions = {
  readonly jobOrigin?: JobOriginPlacement;
};

export type PreparedOutput =
  | {
      readonly ok: true;
      readonly job: Job;
      // Translation applyJobOrigin applied (zero for absolute placements).
      // The preview undoes it to register the toolpath with the scene (H3).
      readonly jobOriginOffset: Vec2;
    }
  | { readonly ok: false; readonly preflight: PreflightResult };

const ZERO_OFFSET: Vec2 = { x: 0, y: 0 };

export function prepareOutput(
  project: Project,
  options: PrepareOutputOptions = {},
): PreparedOutput {
  // Budget guard FIRST so an over-budget raster never reaches compileJob's large
  // allocations (P1-A). A failure flows out as the preflight result; every
  // consumer turns that into "can't" (empty g-code, empty preview, too-large).
  const preEmit = runPreEmitPreflight(project);
  if (!preEmit.ok) return { ok: false, preflight: preEmit };
  const compiled = compileJob(project.scene, project.device);
  const offset = options.jobOrigin ? jobOriginOffset(compiled, options.jobOrigin) : ZERO_OFFSET;
  const placed = options.jobOrigin ? applyJobOrigin(compiled, options.jobOrigin) : compiled;
  // optimize is pure path-order reduction (nearest-neighbor) — same cuts, same
  // speeds, same passes, just shorter travel. Doing it HERE means the preview
  // shows the exact order the machine will run.
  return {
    ok: true,
    job: project.optimization.reduceTravelMoves ? optimizePaths(placed) : placed,
    jobOriginOffset: offset,
  };
}
