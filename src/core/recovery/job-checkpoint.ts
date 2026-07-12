// JobCheckpoint (ADR-118) — the pure description of an interrupted job:
// which program was streaming (a fingerprint, never the G-code text — raster
// jobs exceed browser storage) and how far GRBL acked into it. Deterministic
// G-code (non-negotiable #5) is what makes the fingerprint sufficient: the
// resume path re-compiles the project and refuses when the bytes differ.
//
// Two line-numbering systems meet here and MUST NOT be confused: the
// streamer's `completed`/`total` count SENDABLE lines (blank lines and
// full-line comments are never streamed — isSendableGcodeLine is the single
// definition), while buildResumeProgram and Start-from-line speak RAW file
// line numbers. The checkpoint stores the acked SENDABLE count;
// rawResumeLine() converts it back to a raw line number against the
// re-compiled text at resume time.
//
// Pure core: timestamps are passed in as ISO strings; no clock, no storage.

import { isSendableGcodeLine } from '../controllers/grbl';
import { JOB_ORIGIN_ANCHORS, type JobOriginAnchor, type JobOriginPlacement } from '../job';
import type { OutputScope, Vec2 } from '../scene';
import { parseOptionalJobInterruption, type JobInterruption } from './job-interruption';

// v3 (R1): the checkpoint stores the RESOLVED job origin, not the placement
// settings. A 'current-position' start freezes the live head XY into
// jobOrigin.currentPosition at compile time; storing only {startFrom, anchor}
// let resume re-resolve against the post-crash head, changing the bytes and
// falsely refusing the resume. v2 (PST-02) stored the output scope + settings;
// older slots are discarded on read (transient — a stale recovery prompt only).
export const JOB_CHECKPOINT_SCHEMA_VERSION = 3;

// FNV-1a 32-bit offset basis (public domain reference constant). The FNV
// prime 0x01000193 appears only as its shift decomposition inside
// fingerprintGcode.
const FNV_OFFSET_BASIS = 0x811c9dc5;

export type GcodeFingerprint = {
  // FNV-1a 32-bit over UTF-16 code units, as an unsigned integer.
  readonly fnv1a: number;
  readonly chars: number;
  // Raw '\n'-split line count — buildResumeProgram's numbering.
  readonly lines: number;
};

export type JobMachineKind = 'laser' | 'cnc';

export type JobCheckpoint = {
  readonly schemaVersion: typeof JOB_CHECKPOINT_SCHEMA_VERSION;
  readonly fingerprint: GcodeFingerprint;
  // Sendable (streamed) lines in the program — equals streamer.total, which
  // is how progress updates recognize the checkpointed run.
  readonly sendableLines: number;
  // GRBL acks counted by the streamer, in SENDABLE numbering. An ack means
  // "parsed into the RX buffer", not "executed" — the mapped resume line is
  // exact when only the app died, and a few lines late when the controller
  // lost power too.
  readonly ackedLines: number;
  // True while a resume run (preamble + tail, its own numbering) streams:
  // progress updates are suspended so a coincidental total match can never
  // corrupt ackedLines with foreign counts.
  readonly resumeInFlight: boolean;
  readonly interruption?: JobInterruption;
  readonly machineKind: JobMachineKind;
  // The output scope + RESOLVED job origin the run compiled with. Resume MUST
  // recompile with these, not the (reset-after-crash) live values, or the bytes
  // diverge and the fingerprint check falsely refuses the resume (PST-02, R1).
  // Absent jobOrigin = Absolute Coordinates (no translation, byte-deterministic).
  readonly outputScope: OutputScope;
  readonly jobOrigin?: JobOriginPlacement;
  readonly startedAtIso: string;
  readonly updatedAtIso: string;
};

export function fingerprintGcode(gcode: string): GcodeFingerprint {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < gcode.length; i += 1) {
    hash ^= gcode.charCodeAt(i);
    // hash * 0x01000193 without leaving 32-bit integer safety: the prime is
    // 2^24 + 2^8 + 2^7 + 2^4 + 2^1 + 2^0, composed here from shifts.
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return { fnv1a: hash, chars: gcode.length, lines: gcode.split('\n').length };
}

export function fingerprintsEqual(a: GcodeFingerprint, b: GcodeFingerprint): boolean {
  return a.fnv1a === b.fnv1a && a.chars === b.chars && a.lines === b.lines;
}

export function countSendableLines(gcode: string): number {
  let count = 0;
  for (const line of gcode.split('\n')) if (isSendableGcodeLine(line)) count += 1;
  return count;
}

export function createJobCheckpoint(args: {
  readonly gcode: string;
  readonly machineKind: JobMachineKind;
  readonly outputScope: OutputScope;
  // The resolved job origin the run compiled with; undefined = Absolute (R1).
  readonly jobOrigin?: JobOriginPlacement;
  readonly nowIso: string;
}): JobCheckpoint {
  return {
    schemaVersion: JOB_CHECKPOINT_SCHEMA_VERSION,
    fingerprint: fingerprintGcode(args.gcode),
    sendableLines: countSendableLines(args.gcode),
    ackedLines: 0,
    resumeInFlight: false,
    machineKind: args.machineKind,
    outputScope: args.outputScope,
    ...(args.jobOrigin === undefined ? {} : { jobOrigin: args.jobOrigin }),
    startedAtIso: args.nowIso,
    updatedAtIso: args.nowIso,
  };
}

// Monotonic: progress never moves backwards, and never past the program.
export function advanceJobCheckpoint(
  checkpoint: JobCheckpoint,
  ackedLines: number,
  nowIso: string,
): JobCheckpoint {
  const clamped = Math.min(Math.max(Math.floor(ackedLines), 0), checkpoint.sendableLines);
  if (clamped <= checkpoint.ackedLines) return checkpoint;
  return { ...checkpoint, ackedLines: clamped, updatedAtIso: nowIso };
}

export function markResumeInFlight(checkpoint: JobCheckpoint, nowIso: string): JobCheckpoint {
  if (checkpoint.resumeInFlight) return checkpoint;
  return { ...checkpoint, resumeInFlight: true, updatedAtIso: nowIso };
}

// The 1-based RAW line number of the first un-acked sendable line in `gcode`
// — what Start-from-line / buildResumeProgram expect. Clamped to the last
// sendable line when everything acked; 1 when the program has none.
export function rawResumeLine(gcode: string, ackedSendableLines: number): number {
  const rawLines = gcode.split('\n');
  let sendableSeen = 0;
  let lastSendableRaw = 0;
  for (let i = 0; i < rawLines.length; i += 1) {
    if (!isSendableGcodeLine(rawLines[i] ?? '')) continue;
    sendableSeen += 1;
    lastSendableRaw = i + 1;
    if (sendableSeen > ackedSendableLines) return i + 1;
  }
  return lastSendableRaw === 0 ? 1 : lastSendableRaw;
}

export function serializeJobCheckpoint(checkpoint: JobCheckpoint): string {
  return JSON.stringify(checkpoint);
}

// Strict parse: anything malformed, truncated, or from a future schema reads
// as null — the caller discards it rather than resuming from garbage.
export function parseJobCheckpoint(raw: string): JobCheckpoint | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value['schemaVersion'] !== JOB_CHECKPOINT_SCHEMA_VERSION) return null;
  const fingerprint = value['fingerprint'];
  if (!isFingerprint(fingerprint)) return null;
  return validatedCheckpointBody(value, fingerprint);
}

function validatedCheckpointBody(
  value: Record<string, unknown>,
  fingerprint: GcodeFingerprint,
): JobCheckpoint | null {
  const sendableLines = value['sendableLines'];
  const ackedLines = value['ackedLines'];
  const resumeInFlight = value['resumeInFlight'];
  const machineKind = value['machineKind'];
  const outputScope = parseOutputScope(value['outputScope']);
  const optionalFields = parseOptionalCheckpointFields(value);
  const startedAtIso = value['startedAtIso'];
  const updatedAtIso = value['updatedAtIso'];
  if (!isNonNegativeInteger(sendableLines) || sendableLines > fingerprint.lines) return null;
  if (!isNonNegativeInteger(ackedLines) || ackedLines > sendableLines) return null;
  if (typeof resumeInFlight !== 'boolean') return null;
  if (machineKind !== 'laser' && machineKind !== 'cnc') return null;
  if (outputScope === null || optionalFields === null) return null;
  if (typeof startedAtIso !== 'string' || typeof updatedAtIso !== 'string') return null;
  return {
    schemaVersion: JOB_CHECKPOINT_SCHEMA_VERSION,
    fingerprint,
    sendableLines,
    ackedLines,
    resumeInFlight,
    machineKind,
    outputScope,
    ...optionalFields,
    startedAtIso,
    updatedAtIso,
  };
}

function parseOptionalCheckpointFields(
  value: Record<string, unknown>,
): { readonly interruption?: JobInterruption; readonly jobOrigin?: JobOriginPlacement } | null {
  const interruptionPatch = parseOptionalJobInterruption(value['interruption']);
  const jobOriginPatch = parseOptionalJobOrigin(value['jobOrigin']);
  if (interruptionPatch === null || jobOriginPatch === null) return null;
  return { ...interruptionPatch, ...jobOriginPatch };
}

// jobOrigin is optional (absent = Absolute); present-but-malformed rejects the
// whole checkpoint. Returns a spread-ready patch, or null on malformed.
function parseOptionalJobOrigin(
  value: unknown,
): { readonly jobOrigin?: JobOriginPlacement } | null {
  if (value === undefined) return {};
  const parsed = parseJobOrigin(value);
  return parsed === null ? null : { jobOrigin: parsed };
}

function parseOutputScope(value: unknown): OutputScope | null {
  if (!isRecord(value)) return null;
  const cutSelectedGraphics = value['cutSelectedGraphics'];
  const useSelectionOrigin = value['useSelectionOrigin'];
  const selectedObjectIds = value['selectedObjectIds'];
  if (typeof cutSelectedGraphics !== 'boolean' || typeof useSelectionOrigin !== 'boolean') {
    return null;
  }
  if (!isStringArray(selectedObjectIds)) return null;
  return { cutSelectedGraphics, useSelectionOrigin, selectedObjectIds };
}

// Parse the RESOLVED origin: a 'current-position' origin carries the frozen
// live head XY (currentPosition), which is exactly what resume must reuse to
// reproduce the compiled bytes (R1). The other modes are position-independent.
function parseJobOrigin(value: unknown): JobOriginPlacement | null {
  if (!isRecord(value)) return null;
  const startFrom = value['startFrom'];
  const anchor = value['anchor'];
  if (!isJobStartMode(startFrom) || !isJobOriginAnchor(anchor)) return null;
  if (startFrom === 'current-position') {
    const currentPosition = parseVec2(value['currentPosition']);
    if (currentPosition === null) return null;
    return { startFrom, anchor, currentPosition };
  }
  return { startFrom, anchor };
}

function parseVec2(value: unknown): Vec2 | null {
  if (!isRecord(value)) return null;
  const x = value['x'];
  const y = value['y'];
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  return { x, y };
}

const JOB_START_MODES: ReadonlyArray<JobOriginPlacement['startFrom']> = [
  'absolute',
  'current-position',
  'user-origin',
  'verified-origin',
];

function isJobStartMode(value: unknown): value is JobOriginPlacement['startFrom'] {
  // Widen the literal tuple to string[] purely to test membership of an unknown;
  // the type guard restores the narrow type on success.
  return typeof value === 'string' && (JOB_START_MODES as ReadonlyArray<string>).includes(value);
}

function isJobOriginAnchor(value: unknown): value is JobOriginAnchor {
  // Same membership-of-unknown widening as isJobStartMode, over the shared list.
  return typeof value === 'string' && (JOB_ORIGIN_ANCHORS as ReadonlyArray<string>).includes(value);
}

function isStringArray(value: unknown): value is ReadonlyArray<string> {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFingerprint(value: unknown): value is GcodeFingerprint {
  if (!isRecord(value)) return false;
  const lines = value['lines'];
  return (
    isNonNegativeInteger(value['fnv1a']) &&
    isNonNegativeInteger(value['chars']) &&
    isNonNegativeInteger(lines) &&
    lines >= 1
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
