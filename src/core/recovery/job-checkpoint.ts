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

export const JOB_CHECKPOINT_SCHEMA_VERSION = 1;

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
  readonly machineKind: JobMachineKind;
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
  readonly nowIso: string;
}): JobCheckpoint {
  return {
    schemaVersion: JOB_CHECKPOINT_SCHEMA_VERSION,
    fingerprint: fingerprintGcode(args.gcode),
    sendableLines: countSendableLines(args.gcode),
    ackedLines: 0,
    resumeInFlight: false,
    machineKind: args.machineKind,
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
  const sendableLines = value['sendableLines'];
  const ackedLines = value['ackedLines'];
  const resumeInFlight = value['resumeInFlight'];
  const machineKind = value['machineKind'];
  const startedAtIso = value['startedAtIso'];
  const updatedAtIso = value['updatedAtIso'];
  if (!isNonNegativeInteger(sendableLines) || sendableLines > fingerprint.lines) return null;
  if (!isNonNegativeInteger(ackedLines) || ackedLines > sendableLines) return null;
  if (typeof resumeInFlight !== 'boolean') return null;
  if (machineKind !== 'laser' && machineKind !== 'cnc') return null;
  if (typeof startedAtIso !== 'string' || typeof updatedAtIso !== 'string') return null;
  return {
    schemaVersion: JOB_CHECKPOINT_SCHEMA_VERSION,
    fingerprint,
    sendableLines,
    ackedLines,
    resumeInFlight,
    machineKind,
    startedAtIso,
    updatedAtIso,
  };
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
