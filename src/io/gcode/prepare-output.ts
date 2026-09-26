// prepare-output — the single source of truth for turning a Project into the
// machine Job that everything downstream reasons about: Save, Start, the canvas
// Preview, and the live Estimate. Before this, the Preview built its toolpath
// from RAW compileJob (no optimize, no job-origin) while Save/Start emitted from
// the OPTIMIZED job, so the operator could approve one path order in the preview
// and burn another (roadmap P1-C). prepareOutput runs the identical pipeline for
// every consumer: pre-emit integrity/advisory checks -> compile -> optional job-origin ->
// optimize. Pure: no clock, no random, no I/O.

import {
  applyJobOriginOffset,
  compileJob,
  computeJobBounds,
  computeRegistrationBoxBounds,
  computeSceneOutputBounds,
  jobOriginOffset,
  jobOriginOffsetFromBounds,
  offsetJobBounds,
  optimizePaths,
  type Job,
  type JobBounds,
  type JobOriginPlacement,
} from '../../core/job';
import { compileCncJobResult, type CncJobCompilationResult } from '../../core/cnc/compile-cnc-job';
import {
  COMPILE_INTEGRITY_PREFLIGHT_CODES,
  runPreEmitPreflight,
  type PreflightIssue,
  type PreflightResult,
} from '../../core/preflight';
import {
  DEFAULT_OUTPUT_SCOPE,
  validateOutputScope,
  type OutputScope,
  type Project,
  type Vec2,
} from '../../core/scene';
import {
  isProgramMaterializationRangeError,
  programMaterializationFailure,
} from './program-materialization';
import { reliefMaterializationFailure } from './relief-materialization-failure';
import { contourEntryBoundsForDevice, withContourEntryBounds } from '../../core/job/contour-entry';
import { placeCncParks } from '../../core/job/job-origin';

export type PrepareOutputOptions = {
  readonly jobOrigin?: JobOriginPlacement;
  readonly outputScope?: OutputScope;
  /** Physical entry envelope in the final program frame. Null means unknown.
   * Omitted absolute exports use profile limits; placed jobs require evidence. */
  readonly contourEntryBounds?: JobBounds | null;
  /** Known bed-number to controller-program translation for Absolute jobs.
   * Relative placement modes already choose their own work-coordinate target. */
  readonly absoluteProgramOffset?: Vec2;
  /** Known bed position of program zero for a placed (non-Absolute) job. A
   * configured CNC park is a bed position (ADR-392): without this it cannot be
   * placed, so the job parks at its own start. */
  readonly workZeroBedPosition?: Vec2;
};

export type PreparedOutput =
  | {
      readonly ok: true;
      readonly job: Job;
      readonly project: Project;
      // Translation applyJobOrigin applied (zero for absolute placements).
      // The preview undoes it to register the toolpath with the scene (H3).
      readonly jobOriginOffset: Vec2;
      // Pre-emit findings that inform but never refuse (rule 7 / ADR-228).
      // Optional because a prepared output archived by an earlier build is
      // restored from IndexedDB without this field (prepared-output-persistence);
      // prepareOutput itself always sets it. Read it as `advisories ?? []`.
      readonly advisories?: ReadonlyArray<PreflightIssue>;
    }
  | { readonly ok: false; readonly preflight: PreflightResult };

export type PreparedOutputInput =
  | { readonly ok: false; readonly prepared: PreparedOutput }
  | {
      readonly ok: true;
      readonly sourceProject: Project;
      readonly project: Project;
      readonly outputScope: OutputScope;
      readonly options: PrepareOutputOptions;
      readonly advisories: ReadonlyArray<PreflightIssue>;
    };

const ZERO_OFFSET: Vec2 = { x: 0, y: 0 };

export function prepareOutput(
  project: Project,
  options: PrepareOutputOptions = {},
): PreparedOutput {
  const input = prepareOutputInput(project, options);
  if (!input.ok) return input.prepared;
  try {
    const compiled = compileForMachine(input.project);
    if (compiled.kind === 'relief-materialization-failed') {
      return { ok: false, preflight: reliefMaterializationFailure(compiled) };
    }
    return completePreparedOutput(input, compiled.job);
  } catch (error) {
    if (isProgramMaterializationRangeError(error)) {
      return { ok: false, preflight: programMaterializationFailure() };
    }
    throw error;
  }
}

/** Ordered, synchronous preparation phases that must precede any parallel work. */
export function prepareOutputInput(
  project: Project,
  options: PrepareOutputOptions = {},
): PreparedOutputInput {
  const scoped = validateOutputScope(project.scene, options.outputScope ?? DEFAULT_OUTPUT_SCOPE);
  if (!scoped.ok) {
    return {
      ok: false,
      prepared: {
        ok: false,
        preflight: {
          ok: false,
          issues: scoped.messages.map((message) => ({
            code: 'selected-output-empty',
            message,
          })),
        },
      },
    };
  }
  const outputProject =
    scoped.scene === project.scene ? project : { ...project, scene: scoped.scene };
  // No size refusal remains here (ADR-241/ADR-243): vector scenes of any
  // segment count compile, and rasters of any pixel size stream row-by-row.
  // Compiled-work size measurements surface as Job Review advisories in the
  // Start path instead of failing preparation.
  // Rule 7 / ADR-228: preparation refuses ONLY on compile integrity. Pre-emit
  // reports heuristic policy codes too (speed-out-of-range,
  // scan-offset-out-of-range), and PreflightResult.ok is issues.length === 0 —
  // so refusing on `!preEmit.ok` turned any policy finding into a refusal, and
  // the operator saw a REFUSED .rd export (emit-rd) and a refused tiled CNC
  // export for a finding that merely warns on Start. Split against the one
  // canonical set both the Start and Save paths key off so the three cannot
  // drift apart. An invalid V-carve tool angle is the current pre-compile
  // integrity refusal: there is no honest depth program to materialize without
  // that geometry. Other pre-emit findings remain advisory.
  const preEmit = runPreEmitPreflight(outputProject);
  const blocking = preEmit.issues.filter((issue) =>
    COMPILE_INTEGRITY_PREFLIGHT_CODES.has(issue.code),
  );
  if (blocking.length > 0) {
    return {
      ok: false,
      prepared: { ok: false, preflight: { ok: false, issues: blocking } },
    };
  }
  const advisories = preEmit.issues.filter(
    (issue) => !COMPILE_INTEGRITY_PREFLIGHT_CODES.has(issue.code),
  );
  return {
    ok: true,
    sourceProject: project,
    project: outputProject,
    outputScope: options.outputScope ?? DEFAULT_OUTPUT_SCOPE,
    options,
    advisories,
  };
}

/** Ordered final merge boundary shared by synchronous and worker-backed compilers. */
export function completePreparedOutput(
  input: Extract<PreparedOutputInput, { readonly ok: true }>,
  compiled: Job,
): Extract<PreparedOutput, { readonly ok: true }> {
  const offset =
    (input.options.jobOrigin?.startFrom ?? 'absolute') === 'absolute'
      ? (input.options.absoluteProgramOffset ?? ZERO_OFFSET)
      : input.options.jobOrigin
        ? resolveJobOriginOffset(
            input.sourceProject,
            compiled,
            input.options.jobOrigin,
            input.outputScope,
          )
        : ZERO_OFFSET;
  const entryBounds =
    input.options.contourEntryBounds !== undefined
      ? input.options.contourEntryBounds
      : (input.options.jobOrigin?.startFrom ?? 'absolute') === 'absolute'
        ? offsetJobBounds(contourEntryBoundsForDevice(input.project.device), offset)
        : null;
  const placed = withContourEntryBounds(
    placeCncParks(
      applyJobOriginOffset(compiled, offset),
      cncParkBedToProgram(input.options, offset),
    ),
    entryBounds,
  );
  // Optimization preserves cut geometry/settings while reordering and possibly
  // reversing paths. Joining formerly separated paths can also change planner
  // junction timing, not only travel distance. Doing it HERE means the preview
  // and duration estimate use the exact order the machine will run.
  return {
    ok: true,
    project: input.project,
    job: optimizePaths(
      placed,
      input.sourceProject.optimization,
      input.sourceProject.device.scanningOffsets,
    ),
    jobOriginOffset: offset,
    advisories: input.advisories,
  };
}

// One compile entry per machine kind: the project's machine choice routes to
// the CNC compiler (depth passes, tool offsets) or the laser compiler.
function compileForMachine(project: Project): CncJobCompilationResult {
  const machine = project.machine;
  return machine !== undefined && machine.kind === 'cnc'
    ? compileCncJobResult(project.scene, project.device, machine)
    : { kind: 'compiled', job: compileJob(project.scene, project.device) };
}

// Absolute artwork is in bed numbers, so its park takes the cuts' own
// bed-to-program offset. A placed job's offset only moves the artwork's anchor
// to its target; the park needs where program zero sits on the bed (ADR-392).
function cncParkBedToProgram(options: PrepareOutputOptions, offset: Vec2): Vec2 | null {
  if ((options.jobOrigin?.startFrom ?? 'absolute') === 'absolute') return offset;
  const zero = options.workZeroBedPosition;
  return zero === undefined ? null : { x: -zero.x, y: -zero.y };
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
  if (boxBounds !== null) return jobOriginOffsetFromBounds(boxBounds, jobOrigin, project.device);

  if (outputScope.cutSelectedGraphics && !outputScope.useSelectionOrigin) {
    const fullBounds = fullSceneOutputBounds(project);
    return fullBounds === null
      ? ZERO_OFFSET
      : jobOriginOffsetFromBounds(fullBounds, jobOrigin, project.device);
  }
  return jobOriginOffset(compiled, jobOrigin, project.device);
}

function fullSceneOutputBounds(project: Project): JobBounds | null {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') {
    return computeSceneOutputBounds(project.scene, project.device);
  }
  const compiled = compileCncJobResult(project.scene, project.device, machine);
  return compiled.kind === 'compiled' ? computeJobBounds(compiled.job, project.device) : null;
}
