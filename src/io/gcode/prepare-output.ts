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
  computeRegistrationBoxBounds,
  computeSceneOutputBounds,
  jobOriginOffset,
  jobOriginOffsetFromBounds,
  optimizePaths,
  type Job,
  type JobOriginPlacement,
} from '../../core/job';
import { compileCncJob } from '../../core/cnc';
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
  const compiled = compileForMachine(outputProject);
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
    job: optimizePaths(placed, project.optimization),
    jobOriginOffset: offset,
  };
}

// One compile entry per machine kind: the project's machine choice routes to
// the CNC compiler (depth passes, tool offsets) or the laser compiler.
function compileForMachine(project: Project): Job {
  const machine = project.machine;
  return machine !== undefined && machine.kind === 'cnc'
    ? compileCncJob(project.scene, project.device, machine)
    : compileJob(project.scene, project.device);
}

function resolveJobOriginOffset(
  project: Project,
  compiled: Job,
  jobOrigin: JobOriginPlacement,
  outputScope: OutputScope,
): Vec2 {
  // Registration jig (ADR-057): both burn runs (box outline, then artwork) anchor
  // to the BOX, not to whichever layer is output for that run, so the artwork
  // lands inside the burned box instead of at the bed corner. No-op when no jig
  // is present (returns null -> existing placement logic below).
  const boxBounds = computeRegistrationBoxBounds(project.scene, project.device);
  if (boxBounds !== null) return jobOriginOffsetFromBounds(boxBounds, jobOrigin);

  if (outputScope.cutSelectedGraphics && !outputScope.useSelectionOrigin) {
    const fullBounds = computeSceneOutputBounds(project.scene, project.device);
    return fullBounds === null ? ZERO_OFFSET : jobOriginOffsetFromBounds(fullBounds, jobOrigin);
  }
  return jobOriginOffset(compiled, jobOrigin);
}
