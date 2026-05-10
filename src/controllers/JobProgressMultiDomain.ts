/**
 * T3-44: generic multi-domain job-progress shape.
 *
 * The current `JobProgress` (= `GrblLineStreamProgress`, see
 * `ControllerInterface.ts`) is GRBL-shaped: `linesSent`, `linesAcknowledged`,
 * `totalLines`, `bufferFill`, `ackRateHz`, `expectedAckRateHz`,
 * `healthStatus`. For any non-line-stream controller those fields are
 * meaningless — file-upload controllers care about bytes during upload
 * then about device-reported percent during execute, and binary/native
 * controllers report progress as a percentage they computed themselves
 * with no notion of "lines."
 *
 * Per audit 3A section 3.5, the right model is a multi-domain progress
 * record with always-present `phase` + `percentComplete` + `elapsedMs`
 * plus an optional progress-unit dimension (`'line' | 'byte' | 'percent' |
 * 'device-reported'`) and optional `sent` / `acknowledged` / `total`
 * counts. GRBL-specific health (buffer fill, ack rate) lives in a nested
 * `grblHealth` sub-record so UI can conditionally render the health
 * panel only for controllers that populate it.
 *
 * **This module is purely additive type plumbing.** It does not change
 * the existing `JobProgress` emission or any consumer. `GrblController`
 * keeps emitting `GrblLineStreamProgress`, and `MachineService` /
 * `ConnectionPanel` keep reading the legacy fields. Migration to the
 * multi-domain shape (emission + UI rendering) is filed as future
 * T3-44 follow-up slices, gated on a non-GRBL controller actually
 * shipping. Adopting the shape today buys two things: (1) a stable
 * target for `MachineService.onProgress` callers that want to
 * future-proof their UI, and (2) a test-pinned conversion path proving
 * the GRBL shape can be losslessly mapped into the multi-domain shape.
 *
 * Pairs with T3-43 (controller matrix), T2-24 (controller interface
 * split), and T3-45 (transport abstraction) — all foundation slices
 * that ship the typed contract before any non-GRBL consumer arrives.
 */

import type { GrblLineStreamProgress } from './ControllerInterface';

/**
 * Lifecycle phase of a job. Always populated. Phase transitions are
 * monotonic per job: `preparing → uploading? → streaming|running →
 * (paused → running)? → complete|aborted`. `uploading` is only used
 * by file-upload controllers; line-stream controllers go straight
 * from `preparing` to `streaming`.
 */
export type JobPhase =
  | 'preparing'
  | 'uploading'
  | 'streaming'
  | 'running'
  | 'paused'
  | 'complete'
  | 'aborted';

/**
 * Domain of the optional `sent` / `acknowledged` / `total` counts.
 * `'line'`: classic line-stream (GRBL).
 * `'byte'`: raw transport bytes — used during upload phase or by
 *           binary-stream controllers.
 * `'percent'`: counts are themselves a 0-100 percentage; UI may
 *           prefer to render `percentComplete` directly.
 * `'device-reported'`: the controller emits its own opaque progress
 *           units (Ruida-style); display via `percentComplete` only.
 */
export type ProgressUnit = 'line' | 'byte' | 'percent' | 'device-reported';

/**
 * GRBL streaming-health snapshot. Only populated by GRBL/line-stream
 * controllers; UI renders the health panel iff this sub-record is
 * present. Mirrors the fields on `GrblLineStreamProgress` so legacy
 * UI can read either path.
 */
export interface GrblHealth {
  bufferFill: number;
  healthStatus: 'healthy' | 'warning' | 'saturated';
  ackRateHz: number | null;
  expectedAckRateHz: number | null;
}

/**
 * The multi-domain progress record. `phase`, `percentComplete`, and
 * `elapsedMs` are always populated. Other fields are populated when
 * the controller has data to put in them.
 */
export interface MultiDomainJobProgress {
  readonly phase: JobPhase;
  readonly percentComplete: number;
  readonly elapsedMs: number;
  readonly unit?: ProgressUnit;
  readonly sent?: number;
  readonly acknowledged?: number;
  readonly total?: number;
  readonly grblHealth?: GrblHealth;
}

/**
 * Map a GRBL-shaped `JobProgress` to the multi-domain shape.
 * Lossless — every legacy field has a home in `unit:'line'` counts
 * or `grblHealth`. Phase defaults to `'streaming'` because that's
 * what the legacy emitter implicitly meant; callers in `preparing`
 * or `complete` should pass the explicit phase.
 */
export function toMultiDomainGrblProgress(
  progress: GrblLineStreamProgress,
  phase: JobPhase = 'streaming',
): MultiDomainJobProgress {
  return {
    phase,
    percentComplete: progress.percentComplete,
    elapsedMs: progress.elapsedMs,
    unit: 'line',
    sent: progress.linesSent,
    acknowledged: progress.linesAcknowledged,
    total: progress.totalLines,
    grblHealth: {
      bufferFill: progress.bufferFill,
      healthStatus: progress.healthStatus,
      ackRateHz: progress.ackRateHz,
      expectedAckRateHz: progress.expectedAckRateHz,
    },
  };
}

/**
 * Build a byte-domain progress record (used by file-upload controllers
 * during the upload phase, before device execution begins). `total`
 * is required because byte progress without a known total is not
 * useful — the UI would have nothing to compute percentComplete from.
 */
export function makeUploadProgress(args: {
  readonly bytesSent: number;
  readonly totalBytes: number;
  readonly elapsedMs: number;
}): MultiDomainJobProgress {
  const total = Math.max(0, args.totalBytes);
  const sent = Math.max(0, Math.min(args.bytesSent, total));
  const percentComplete = total === 0 ? 0 : Math.min(100, (sent / total) * 100);
  return {
    phase: 'uploading',
    percentComplete,
    elapsedMs: args.elapsedMs,
    unit: 'byte',
    sent,
    total,
  };
}

/**
 * Build a device-reported progress record (used by Ruida-shape /
 * native-binary controllers that report their own percentage and do
 * not expose host-side line/byte counts). `percentComplete` is the
 * authoritative value; `unit` is `'device-reported'` so UI can pick
 * the right rendering and skip count-based sub-displays.
 */
export function makeDeviceReportedProgress(args: {
  readonly percentComplete: number;
  readonly elapsedMs: number;
  readonly phase?: 'running' | 'paused' | 'complete' | 'aborted';
}): MultiDomainJobProgress {
  const clampedPercent = Math.max(0, Math.min(100, args.percentComplete));
  return {
    phase: args.phase ?? 'running',
    percentComplete: clampedPercent,
    elapsedMs: args.elapsedMs,
    unit: 'device-reported',
  };
}

/**
 * Type-narrowing guard: `progress.grblHealth` populated. UI panels that
 * only make sense for GRBL (buffer fill bar, ack-rate sparkline) gate
 * on this rather than on `progress.unit === 'line'`, because future
 * line-stream controllers might not all emit GRBL-style health.
 */
export function hasGrblHealth(
  progress: MultiDomainJobProgress,
): progress is MultiDomainJobProgress & { grblHealth: GrblHealth } {
  return progress.grblHealth !== undefined;
}

/**
 * Type-narrowing guard: progress carries a count-based unit
 * (`'line'` or `'byte'`) with the count fields populated. UI count
 * displays gate on this so they don't render `'sent: 100 / 0'`-style
 * artifacts when only `percentComplete` is meaningful.
 */
export function hasCountProgress(
  progress: MultiDomainJobProgress,
): progress is MultiDomainJobProgress & {
  unit: 'line' | 'byte';
  sent: number;
  total: number;
} {
  return (
    (progress.unit === 'line' || progress.unit === 'byte')
    && typeof progress.sent === 'number'
    && typeof progress.total === 'number'
  );
}

/**
 * Phase classification helpers. Useful for UI logic that gates on
 * "is the job actively running?" without hard-coding the phase set.
 */
export function isActivePhase(phase: JobPhase): boolean {
  return phase === 'streaming' || phase === 'running' || phase === 'uploading';
}

export function isTerminalPhase(phase: JobPhase): boolean {
  return phase === 'complete' || phase === 'aborted';
}
