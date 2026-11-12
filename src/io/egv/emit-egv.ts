// emitEgvFile — the Lihuiyu twin of emitGcode and emitRdFile (ADR-703): runs
// the SAME prepareOutput pipeline (preview = save, ADR-040), encodes the
// LHYMicro-GL command stream and wraps it in the .egv header MeerK40t writes
// (meerk40t/lihuiyu/device.py at d511944e, egv_save L900-919), then runs the
// post-compile checks a G-code save runs over the moves the file commands.
// No driver or USB access is needed, so it works on the web.
//
// An .egv stream is relative to the head: it starts where the head stands and
// returns there. An Absolute job expects the head at home (machine zero,
// after Home); an origin-relative job expects it at the job's origin.

import {
  encodeLhyJob,
  lhyBoardSetting,
  type LhyEncodeError,
} from '../../core/controllers/lihuiyu/lhy-encoder';
import { lhyFootprint, type LhyFootprint } from '../../core/controllers/lihuiyu/lhy-frame';
import type { LhyPoint } from '../../core/controllers/lihuiyu/lhy-motion-plan';
import { machineSpaceJob, type JobOriginPlacement } from '../../core/job';
import { rotaryOutputAxis } from '../../core/job/rotary-job';
import { rotaryFeedMatchFor } from '../../core/output/rotary-surface-feed';
import type { PreflightIssue, PreflightOptions } from '../../core/preflight';
import { withoutRepeatedIssues } from '../../core/preflight/without-repeated-issues';
import type { OutputScope, Project } from '../../core/scene';
import { prepareOutput, type PreparedOutput, type PrepareOutputOptions } from '../gcode';
import { rotaryAxisUnsupportedMessage } from '../gcode/rotary-axis-emit';
import { egvAdvisories } from './egv-advisories';
import { runEgvPreflight, type EgvPreflightFrame } from './egv-preflight';

export type EmitEgvOptions = {
  readonly jobOrigin?: JobOriginPlacement;
  readonly outputScope?: OutputScope;
  /** As EmitRdOptions: the value Save would pass a G-code save. */
  readonly preflightMotionOffset?: PreflightOptions['motionOffset'];
  readonly preflightCoordinateMode?: 'machine' | 'relative-origin';
  /** Where the head stands, in job coordinates; absent: the job's zero. */
  readonly start?: LhyPoint;
};

export type EmitEgvResult =
  | {
      readonly ok: true;
      /** The whole .egv file: header and command stream. */
      readonly bytes: Uint8Array;
      /** The command stream alone, as the USB link sends it. */
      readonly stream: Uint8Array;
      readonly footprint: LhyFootprint;
      readonly advisories: ReadonlyArray<PreflightIssue>;
    }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

export const EGV_HEADER =
  'Document type : LHYMICRO-GL file\nFile version: 1.0.01\nCopyright: Unknown\n' +
  'Creator-Software: KerfDesk\n\n%0%0%0%0%\n';

export function emitEgvFile(project: Project, options: EmitEgvOptions = {}): EmitEgvResult {
  return emitPreparedEgvFile(prepareOutput(project, egvPreparationOptions(options)), options);
}

export function egvPreparationOptions(options: EmitEgvOptions): PrepareOutputOptions {
  return {
    ...(options.jobOrigin ? { jobOrigin: options.jobOrigin } : {}),
    ...(options.outputScope ? { outputScope: options.outputScope } : {}),
  };
}

/** Encodes a prepared output; `options` must be the ones it was prepared with. */
export function emitPreparedEgvFile(
  prepared: PreparedOutput,
  options: EmitEgvOptions = {},
): EmitEgvResult {
  if (!prepared.ok) {
    return { ok: false, messages: prepared.preflight.issues.map((issue) => issue.message) };
  }
  const { device, machine } = prepared.project;
  if (device.origin !== 'rear-left') return { ok: false, messages: [ORIGIN_MESSAGE] };
  const rotaryAxis = rotaryOutputAxis(device, machine);
  if (rotaryAxis !== null) {
    return {
      ok: false,
      messages: [rotaryAxisUnsupportedMessage(prepared.project, rotaryAxis) ?? ''],
    };
  }
  const board = lhyBoardSetting(device.lihuiyuBoard);
  const start = options.start ?? { x: 0, y: 0 };
  const machineJob = machineSpaceJob(prepared.job, device, machine);
  // A Y-port rotary matches the surface speed per burn (ADR-703 Amendment 1).
  const rotaryFeed = rotaryFeedMatchFor(machineJob, device.maxFeed);
  const encoded = encodeLhyJob(machineJob, {
    board,
    fullPowerPerMille: device.maxPowerS,
    start,
    scanningOffsets: device.scanningOffsets,
    ...(rotaryFeed === undefined ? {} : { rotaryFeed }),
  });
  if (!encoded.ok) return { ok: false, messages: [describeLhyEncodeError(encoded.error)] };
  const footprint = lhyFootprint(encoded.motion, start);
  if (footprint === null)
    return { ok: false, messages: [describeLhyEncodeError({ kind: 'empty-job' })] };
  const checks = runEgvPreflight(prepared.project, encoded.motion, preflightFrame(options));
  return {
    ok: true,
    bytes: withEgvHeader(encoded.stream),
    stream: encoded.stream,
    footprint,
    advisories: withoutRepeatedIssues([
      ...(prepared.advisories ?? []),
      ...checks,
      ...egvAdvisories(encoded, board, prepared.job),
    ]),
  };
}

// The frame rule emitGcode's preflight uses: a placed job with no known
// offset is checked for size only, relative to its own origin.
function preflightFrame(options: EmitEgvOptions): EgvPreflightFrame {
  const coordinateMode =
    options.preflightCoordinateMode ??
    (options.jobOrigin !== undefined && options.preflightMotionOffset === undefined
      ? 'relative-origin'
      : 'machine');
  return { motionOffset: options.preflightMotionOffset, coordinateMode };
}

function withEgvHeader(stream: Uint8Array): Uint8Array {
  const header = new TextEncoder().encode(EGV_HEADER);
  const bytes = new Uint8Array(header.length + stream.length);
  bytes.set(header);
  bytes.set(stream, header.length);
  return bytes;
}

const ORIGIN_MESSAGE =
  'A Lihuiyu board homes to the rear-left corner and its moves run from there. Set the machine origin to Rear left in Machine Setup. No output bytes were produced.';

function describeLhyEncodeError(error: LhyEncodeError): string {
  switch (error.kind) {
    case 'empty-job':
      return 'Nothing to export — enable Output on at least one layer with geometry and power above 0 %.';
    case 'cnc-unsupported':
      return 'A CNC router job cannot be written for a Lihuiyu laser board. Switch the project to Laser mode.';
    case 'angled-raster-unsupported':
      return `Layer ${error.layerId} scans its image at an angle, which the Lihuiyu encoder does not write. Set the scan angle to 0°.`;
    case 'speed-out-of-range':
      return `Layer ${error.layerId} speed (${error.mmPerMin} mm/min) is not a positive speed. No output bytes were produced.`;
  }
}
