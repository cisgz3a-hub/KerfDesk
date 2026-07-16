// emitGcode — runs the Phase A pipeline (compile → emit → preflight) over a
// Project and returns the G-code string plus the preflight verdict. Pure: no
// I/O. The UI / platform adapter decides whether to actually write the file
// based on `preflight.ok`.

import {
  runCncPreflight,
  runPreflight,
  type PreflightOptions,
  type PreflightResult,
} from '../../core/preflight';
import {
  machineSpaceJob,
  rotaryAppliesTo,
  rotaryWrapLimitMm,
  type Job,
  type JobOriginPlacement,
} from '../../core/job';
import { emitCncJobWithPassSpans, selectOutputStrategy, type CncPassSpan } from '../../core/output';
import type { OutputScope, Project } from '../../core/scene';
import {
  gcodeMetadataHeader,
  type GcodeHeaderAssumptions,
  type GcodeMetadata,
} from './gcode-metadata';
import { prepareOutput } from './prepare-output';
import type { PreparedOutput } from './prepare-output';

export type EmitGcodeResult = {
  readonly gcode: string;
  readonly preflight: PreflightResult;
};

export type EmitGcodeOptions = {
  readonly jobOrigin?: JobOriginPlacement;
  readonly outputScope?: OutputScope;
  readonly preflightMotionOffset?: PreflightOptions['motionOffset'];
  readonly preflightInitialMachinePosition?: PreflightOptions['initialMachinePosition'];
  readonly allowRotaryRaster?: boolean;
  // When set, a provenance comment header (build/commit/emitter) is prepended to
  // the returned G-code. Preflight runs on the motion body only, so the header
  // never affects the verdict, and callers that need deterministic, header-free
  // output (tests, preview) simply omit it.
  readonly metadata?: GcodeMetadata;
};

export function emitGcode(project: Project, options: EmitGcodeOptions = {}): EmitGcodeResult {
  // Compile / place / optimize + the pre-emit budget guard all live in
  // prepareOutput — the SAME pipeline the canvas preview and live estimate use,
  // so what is previewed is what is emitted (roadmap P1-C). A budget failure
  // short-circuits here with empty g-code + the failing preflight (the UI shows
  // the reason instead of freezing, roadmap P1-A).
  const prepared = prepareOutput(project, {
    ...(options.jobOrigin ? { jobOrigin: options.jobOrigin } : {}),
    ...(options.outputScope ? { outputScope: options.outputScope } : {}),
  });
  return emitPreparedGcode(prepared, options);
}

export function emitPreparedGcode(
  prepared: PreparedOutput,
  options: EmitGcodeOptions = {},
): EmitGcodeResult {
  const { gcode, preflight } = emitPreparedGcodeWithCncPassSpans(prepared, options);
  return { gcode, preflight };
}

export type EmitPreparedCncGcodeResult = EmitGcodeResult & {
  /** Raw-line span of every emitted CNC pass (ADR-215). Null for non-CNC
   * projects, refused emissions, and metadata-headed output (a prepended
   * header shifts raw line numbers, so spans would not describe `gcode`). */
  readonly spans: ReadonlyArray<CncPassSpan> | null;
};

/** emitPreparedGcode plus the CNC pass-span sidecar. The G-code is
 * byte-identical to emitPreparedGcode for the same inputs. */
export function emitPreparedGcodeWithCncPassSpans(
  prepared: PreparedOutput,
  options: EmitGcodeOptions = {},
): EmitPreparedCncGcodeResult {
  if (!prepared.ok) return { gcode: '', preflight: prepared.preflight, spans: null };
  const machine = prepared.project.machine;
  // Scale Y at the last moment so design previews stay surface-true. Raster
  // remains fail-closed unless the caller proves the Labs gate.
  const rotaryStage = applyRotaryStage(
    prepared.project,
    prepared.job,
    options.allowRotaryRaster === true,
  );
  if (rotaryStage.kind === 'refused') {
    return { gcode: '', preflight: rotaryStage.preflight, spans: null };
  }
  const job = rotaryStage.job;
  // CNC router projects always emit through the Z-aware GRBL strategy; laser
  // projects pick their controller dialect via the ADR-094 driver seam.
  const cncEmission =
    machine !== undefined && machine.kind === 'cnc'
      ? emitCncJobWithPassSpans(job, prepared.project.device)
      : null;
  const body =
    cncEmission !== null
      ? cncEmission.gcode
      : selectOutputStrategy(prepared.project.device).emit(
          job,
          prepared.project.device,
          currentPositionFinishOptions(options.jobOrigin),
        );
  // Preflight the motion body, NOT the header — the provenance comments are
  // inert to every invariant (all strip comments) but keeping them out of the
  // preflight input makes that guarantee explicit.
  const preflight = runEmitPreflight(prepared.project, body, options, rotaryStage);
  const gcode = options.metadata
    ? gcodeMetadataHeader(options.metadata, headerAssumptionsFor(prepared.project)) + body
    : body;
  const spans = cncEmission !== null && options.metadata === undefined ? cncEmission.spans : null;
  return { gcode, preflight, spans };
}

function currentPositionFinishOptions(jobOrigin: JobOriginPlacement | undefined): {
  readonly finishPosition?: { readonly x: number; readonly y: number };
} {
  return jobOrigin?.startFrom === 'current-position'
    ? { finishPosition: jobOrigin.currentPosition }
    : {};
}

function runEmitPreflight(
  project: Project,
  body: string,
  options: EmitGcodeOptions,
  rotaryStage: Extract<RotaryStage, { kind: 'ok' }>,
): PreflightResult {
  const machine = project.machine;
  const coordinateMode =
    options.jobOrigin !== undefined && options.preflightMotionOffset === undefined
      ? 'relative-origin'
      : 'machine';
  if (machine !== undefined && machine.kind === 'cnc') {
    return runCncPreflight(project, machine, body, {
      motionOffset: options.preflightMotionOffset,
      initialMachinePosition: options.preflightInitialMachinePosition,
      coordinateMode,
    });
  }
  return runPreflight(project, body, {
    motionOffset: options.preflightMotionOffset,
    initialMachinePosition: options.preflightInitialMachinePosition,
    coordinateMode,
    // One revolution is the wrap limit: a taller job burns onto its own
    // start (ADR-127).
    ...(rotaryStage.boundsHeightOverrideMm !== undefined
      ? { boundsHeightOverrideMm: rotaryStage.boundsHeightOverrideMm }
      : {}),
  });
}

type RotaryStage =
  | { readonly kind: 'refused'; readonly preflight: PreflightResult }
  | { readonly kind: 'ok'; readonly job: Job; readonly boundsHeightOverrideMm?: number };

// Delegate Y scale/rebase + wrap limit to the shared machine-space helper.
// CNC and disabled rotary pass through untouched.
function applyRotaryStage(project: Project, job: Job, allowRotaryRaster: boolean): RotaryStage {
  if (!rotaryAppliesTo(project.device, project.machine)) return { kind: 'ok', job };
  if (!allowRotaryRaster && job.groups.some((group) => group.kind === 'raster')) {
    return {
      kind: 'refused',
      preflight: {
        ok: false,
        issues: [
          {
            code: 'rotary-raster-unsupported',
            message:
              'Rotary image engraving is experimental and disabled. ' +
              'Enable it in Tools > Labs, disable the rotary, or remove the image layer.',
          },
        ],
      },
    };
  }
  const boundsHeightOverrideMm = rotaryWrapLimitMm(project.device, project.machine);
  return {
    kind: 'ok',
    job: machineSpaceJob(job, project.device, project.machine),
    ...(boundsHeightOverrideMm !== null ? { boundsHeightOverrideMm } : {}),
  };
}

// The provenance header's assumption lines are machine-specific (ADR-103
// defect fix): laser files record the $30 S-scale; router files record the
// RPM mapping and $32=0.
function headerAssumptionsFor(project: Project): GcodeHeaderAssumptions {
  const machine = project.machine;
  return machine !== undefined && machine.kind === 'cnc'
    ? { kind: 'cnc', spindleMaxRpm: machine.params.spindleMaxRpm }
    : { kind: 'laser', maxPowerS: project.device.maxPowerS };
}
