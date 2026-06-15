// prepare-output — the single source of truth for turning a Project into the
// machine Job that everything downstream reasons about: Save, Start, the canvas
// Preview, and the live Estimate. Before this, the Preview built its toolpath
// from RAW compileJob (no optimize, no job-origin) while Save/Start emitted from
// the OPTIMIZED job, so the operator could approve one path order in the preview
// and burn another (roadmap P1-C). prepareOutput runs the identical pipeline for
// every consumer: pre-emit budget guard -> compile -> optional job-origin ->
// optimize. Pure: no clock, no random, no I/O.

import {
  applyJobOriginOffset,
  compileJob,
  computeSceneOutputBounds,
  jobOriginOffset,
  jobOriginOffsetFromBounds,
  optimizePaths,
  type Job,
  type JobOriginPlacement,
} from '../../core/job';
import { runPreEmitPreflight, type PreflightResult } from '../../core/preflight';
import {
  DEFAULT_OUTPUT_SCOPE,
  validateOutputScope,
  type OutputScope,
  type Project,
  type Vec2,
} from '../../core/scene';

export type PrepareOutputOptions = {
  readonly jobOrigin?: JobOriginPlacement;
  readonly outputScope?: OutputScope;
};

export type PreparedOutput =
  | {
      readonly ok: true;
      readonly job: Job;
      readonly project: Project;
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
  const scoped = validateOutputScope(project.scene, options.outputScope ?? DEFAULT_OUTPUT_SCOPE);
  if (!scoped.ok) {
    return {
      ok: false,
      preflight: {
        ok: false,
        issues: scoped.messages.map((message) => ({
          code: 'selected-output-empty',
          message,
        })),
      },
    };
  }
  const outputProject =
    scoped.scene === project.scene ? project : { ...project, scene: scoped.scene };
  // Budget guard FIRST so an over-budget raster never reaches compileJob's large
  // allocations (P1-A). A failure flows out as the preflight result; every
  // consumer turns that into "can't" (empty g-code, empty preview, too-large).
  const preEmit = runPreEmitPreflight(outputProject);
  if (!preEmit.ok) return { ok: false, preflight: preEmit };
  const compiled = compileJob(outputProject.scene, outputProject.device);
  const outputScope = options.outputScope ?? DEFAULT_OUTPUT_SCOPE;
  const offset = options.jobOrigin
    ? resolveJobOriginOffset(project, compiled, options.jobOrigin, outputScope)
    : ZERO_OFFSET;
  const placed = applyJobOriginOffset(compiled, offset);
  // optimize is pure path-order reduction (nearest-neighbor) — same cuts, same
  // speeds, same passes, just shorter travel. Doing it HERE means the preview
  // shows the exact order the machine will run.
  return {
    ok: true,
    project: outputProject,
    job: project.optimization.reduceTravelMoves ? optimizePaths(placed) : placed,
    jobOriginOffset: offset,
  };
}

function resolveJobOriginOffset(
  project: Project,
  compiled: Job,
  jobOrigin: JobOriginPlacement,
  outputScope: OutputScope,
): Vec2 {
  if (outputScope.cutSelectedGraphics && !outputScope.useSelectionOrigin) {
    const fullBounds = computeSceneOutputBounds(project.scene, project.device);
    return fullBounds === null ? ZERO_OFFSET : jobOriginOffsetFromBounds(fullBounds, jobOrigin);
  }
  return jobOriginOffset(compiled, jobOrigin);
}
