// emitRdFile — the Ruida twin of emitGcode: runs the SAME prepareOutput
// pipeline (preview = save, ADR-040), encodes the .rd byte stream, then runs
// the post-compile checks a G-code save runs over the moves the file commands.

import { encodeRdJob, type RdEncodeError } from '../../core/controllers/ruida';
import { machineSpaceJob, type JobOriginPlacement } from '../../core/job';
import type { PreflightIssue, PreflightOptions } from '../../core/preflight';
import type { OutputScope, Project } from '../../core/scene';
import { prepareOutput, type PreparedOutput } from '../gcode';
import { runRdPreflight, type RdPreflightFrame } from './rd-preflight';

export type EmitRdOptions = {
  /** The export placement. It also picks the file's reference-point mode. */
  readonly jobOrigin?: JobOriginPlacement;
  readonly outputScope?: OutputScope;
  /** Program XY to the configured bed frame, with the meaning EmitGcodeOptions
   *  gives it; Save passes the value it would pass a G-code save. */
  readonly preflightMotionOffset?: PreflightOptions['motionOffset'];
  /** Explicit for a runtime whose native-to-bed mapping is unknown. */
  readonly preflightCoordinateMode?: 'machine' | 'relative-origin';
};

export type EmitRdResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      // Findings that inform but never refuse (rule 7 / ADR-228): the pre-emit
      // findings plus the post-compile checks over the file's moves (audit
      // RU-7). handleSaveRd toasts them after the write.
      readonly advisories: ReadonlyArray<PreflightIssue>;
    }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

export function emitRdFile(project: Project, options: EmitRdOptions = {}): EmitRdResult {
  const prepared = prepareOutput(project, {
    ...(options.jobOrigin ? { jobOrigin: options.jobOrigin } : {}),
    ...(options.outputScope ? { outputScope: options.outputScope } : {}),
  });
  return emitPreparedRdFile(prepared, options);
}

/** Encodes a previously prepared output without compiling the project again.
 *  `options` must be the ones the output was prepared with. */
export function emitPreparedRdFile(
  prepared: PreparedOutput,
  options: EmitRdOptions = {},
): EmitRdResult {
  if (!prepared.ok) {
    return { ok: false, messages: prepared.preflight.issues.map((issue) => issue.message) };
  }
  // Ruida export is the twin of emitGcode: apply the same rotary machine-space
  // scaling so a saved .rd matches the streamed G-code (identity for
  // non-rotary; rotary raster is refused by the encoder below) — review R3.
  const machineJob = machineSpaceJob(
    prepared.job,
    prepared.project.device,
    prepared.project.machine,
  );
  const encoded = encodeRdJob(
    machineJob,
    prepared.project.device,
    options.jobOrigin === undefined ? {} : { jobOrigin: options.jobOrigin },
  );
  if (!encoded.ok) return { ok: false, messages: [describeRdEncodeError(encoded.error)] };
  const checks = runRdPreflight(prepared.project, encoded.motion, preflightFrame(options));
  return {
    ok: true,
    bytes: encoded.bytes,
    advisories: withoutRepeats([...(prepared.advisories ?? []), ...checks]),
  };
}

// The frame rule emitGcode's preflight uses: a placed job with no known
// offset is checked for size only, relative to its own origin.
function preflightFrame(options: EmitRdOptions): RdPreflightFrame {
  const coordinateMode =
    options.preflightCoordinateMode ??
    (options.jobOrigin !== undefined && options.preflightMotionOffset === undefined
      ? 'relative-origin'
      : 'machine');
  return { motionOffset: options.preflightMotionOffset, coordinateMode };
}

// runPreflight repeats some pre-emit findings (the controlled-travel feed),
// and several moves of one layer can relabel to the same message.
function withoutRepeats(issues: ReadonlyArray<PreflightIssue>): ReadonlyArray<PreflightIssue> {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}\n${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function describeRdEncodeError(error: RdEncodeError): string {
  switch (error.kind) {
    case 'empty-job':
      return 'Nothing to export — enable Output on at least one layer with geometry.';
    case 'cnc-unsupported':
      return 'A CNC router job cannot be exported as a Ruida .rd laser file. Switch the project to Laser mode, or choose a GRBL-family machine profile for router jobs.';
    case 'raster-unsupported':
      return `Layer ${error.layerId} uses Fill/Image raster output, which the experimental .rd encoder does not support yet. Use Line mode layers for Ruida export.`;
    case 'too-many-layers':
      return `The job has ${error.count} layers; Ruida files support at most 100.`;
    case 'coordinate-out-of-range':
      return `Compiled coordinate ${error.path} (${error.valueUm} µm) is outside Ruida's signed 35-bit range (${error.minUm}..${error.maxUm} µm). No output bytes were produced.`;
    case 'speed-out-of-range':
      return `Layer ${error.layerId} speed (${error.valueUmPerSec} µm/s) is outside Ruida's signed 35-bit representation (${error.minUmPerSec}..${error.maxUmPerSec} µm/s). No output bytes were produced.`;
  }
}
