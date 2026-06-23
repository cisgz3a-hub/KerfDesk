// laser-store-helpers — pure factories and patch builders extracted from
// laser-store.ts to keep that file under the ADR-015 size cap. There is no
// runtime import cycle: the LaserState import below is type-only (erased at
// build), so this module depends only on the controller + safety-notice modules
// at runtime.

import {
  CMD_COOLANT_OFF,
  RT_JOG_CANCEL,
  RT_SOFT_RESET,
  disconnect as disconnectStreamer,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import { controllerOperationCommandBlockMessage } from './laser-controller-operation';
import { disconnectDuringJobNotice } from './laser-safety-notice';
import type { LaserState } from './laser-store';

const LOG_MAX = 200;
const AUTOFOCUS_BUSY_MESSAGE =
  'Auto-focus is running. Wait for it to finish before sending other motion commands.';
export const ACTIVE_JOB_COMMAND_MESSAGE =
  'A job is active. Press Stop before sending setup, jog, home, unlock, origin, settings, or autofocus commands.';
export const UNKNOWN_IDLE_STATUS_MESSAGE =
  'Controller status is not known yet. Wait for an Idle status report before jogging or framing.';
export const MOTION_OPERATION_ACTIVE_MESSAGE =
  'A jog or frame operation is active. Wait for GRBL to report Idle, or cancel the operation, before sending another motion command.';

export function serialWriteErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function pushLog(state: LaserState, line: string): ReadonlyArray<string> {
  return [...state.log, line].slice(-LOG_MAX);
}

// "done" only means GRBL acknowledged every line, not that the planner has
// physically finished motion. laser-line-handler clears the streamer after a
// later Idle status report.
export function isActiveJob(streamer: StreamerState | null): boolean {
  return streamer !== null && ['streaming', 'paused', 'done', 'errored'].includes(streamer.status);
}

export function activeJobCommandBlockMessage(state: LaserState): string | null {
  return isActiveJob(state.streamer) ? ACTIVE_JOB_COMMAND_MESSAGE : null;
}

export function motionOperationCommandBlockMessage(state: LaserState): string | null {
  return state.motionOperation !== null
    ? MOTION_OPERATION_ACTIVE_MESSAGE
    : controllerOperationCommandBlockMessage(state.controllerOperation);
}

export function setupCommandBlockMessage(state: LaserState): string | null {
  return activeJobCommandBlockMessage(state) ?? motionOperationCommandBlockMessage(state);
}

export function jogFrameCommandBlockMessage(state: LaserState): string | null {
  const activeJobMessage = activeJobCommandBlockMessage(state);
  if (activeJobMessage !== null) return activeJobMessage;
  const motionOperationMessage = motionOperationCommandBlockMessage(state);
  if (motionOperationMessage !== null) return motionOperationMessage;
  const controllerOperationMessage = controllerOperationCommandBlockMessage(
    state.controllerOperation,
  );
  if (controllerOperationMessage !== null) return controllerOperationMessage;
  if (state.statusReport === null) return UNKNOWN_IDLE_STATUS_MESSAGE;
  if (state.statusReport.state !== 'Idle') {
    return `Machine must be Idle before jogging or framing (currently ${state.statusReport.state}).`;
  }
  return null;
}

export function idleOnlyDollarCommandBlockMessage(
  state: LaserState,
  payload: string,
): string | null {
  if (!payloadContainsDollarLineCommand(payload)) return null;
  return activeJobCommandBlockMessage(state);
}

export function disconnectStopCommands(state: LaserState): ReadonlyArray<string> {
  if (isActiveJob(state.streamer)) return [RT_SOFT_RESET, `${CMD_COOLANT_OFF}\n`];
  return state.motionOperation !== null ? [RT_JOG_CANCEL] : [];
}

export function assertAutofocusIdle(state: LaserState): void {
  if (state.autofocusBusy) throw new Error(AUTOFOCUS_BUSY_MESSAGE);
}

export function assertNoActiveJob(state: LaserState): void {
  const message = activeJobCommandBlockMessage(state);
  if (message !== null) throw new Error(message);
}

function payloadContainsDollarLineCommand(payload: string): boolean {
  return payload.split(/\r?\n/).some((line) => line.trim().startsWith('$'));
}

// M13 (AUDIT-2026-06-10): ack watchdog. The streamer is purely ack-driven —
// if GRBL stops answering while lines are in flight, the job froze silently
// forever. The status poll feeds this detector each tick. Use a longer grace
// window while the controller is still in Run so slow moves do not look like
// dead USB. Feed hold / door states legitimately silence acks, so they reset
// the clock.
export const STREAM_STALL_TIMEOUT_MS = 10_000;
export const STREAM_STALL_RUNNING_TIMEOUT_MS = 90_000;

export type StallProbe = {
  readonly completed: number;
  readonly inFlightBytes: number;
  readonly queuedCount: number;
  readonly statusReport: StatusReport | null;
  readonly at: number;
} | null;

export function detectStreamStall(
  streamer: StreamerState | null,
  statusReport: StatusReport | null,
  prev: StallProbe,
  now: number,
): { readonly probe: StallProbe; readonly stalled: boolean } {
  if (!isStallWatchActive(streamer)) return { probe: null, stalled: false };
  if (statusPausesStallWatch(statusReport)) return { probe: null, stalled: false };
  const unchanged = streamPositionUnchanged(prev, streamer) && !freshRunStatus(prev, statusReport);
  const at = unchanged ? prev.at : now;
  const timeoutMs = streamStallTimeoutMs(statusReport);
  return {
    probe: {
      completed: streamer.completed,
      inFlightBytes: streamer.inFlightBytes,
      queuedCount: streamer.queued.length,
      statusReport,
      at,
    },
    stalled: now - at >= timeoutMs,
  };
}

function streamStallTimeoutMs(statusReport: StatusReport | null): number {
  return statusReport?.state === 'Run' ? STREAM_STALL_RUNNING_TIMEOUT_MS : STREAM_STALL_TIMEOUT_MS;
}

function isStallWatchActive(streamer: StreamerState | null): streamer is StreamerState {
  return streamer !== null && streamer.status === 'streaming' && streamer.inFlight.length > 0;
}

function statusPausesStallWatch(statusReport: StatusReport | null): boolean {
  return statusReport?.state === 'Hold' || statusReport?.state === 'Door';
}

function freshRunStatus(prev: StallProbe, statusReport: StatusReport | null): boolean {
  return (
    prev !== null &&
    statusReport !== null &&
    prev.statusReport !== statusReport &&
    statusReport.state === 'Run'
  );
}

function streamPositionUnchanged(
  prev: StallProbe,
  streamer: StreamerState,
): prev is NonNullable<StallProbe> {
  return (
    prev !== null &&
    prev.completed === streamer.completed &&
    prev.inFlightBytes === streamer.inFlightBytes &&
    prev.queuedCount === streamer.queued.length
  );
}

export function initialLaserState(): Pick<
  LaserState,
  | 'connection'
  | 'statusReport'
  | 'alarmCode'
  | 'lastError'
  | 'lastWriteError'
  | 'safetyNotice'
  | 'autofocusBusy'
  | 'motionOperation'
  | 'controllerOperation'
  | 'streamer'
  | 'homingState'
  | 'log'
  | 'transcript'
  | 'detectedSettings'
  | 'controllerSettings'
  | 'grblSettingsRows'
  | 'lastSettingsReadAt'
  | 'wcoCache'
  | 'workOriginActive'
  | 'frameVerification'
> {
  return {
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastError: null,
    lastWriteError: null,
    safetyNotice: null,
    autofocusBusy: false,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    homingState: 'unknown',
    log: [],
    transcript: [],
    detectedSettings: null,
    controllerSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    wcoCache: null,
    workOriginActive: false,
    frameVerification: null,
  };
}

// Patch applied when the serial port closes (the onClose handler). Marks
// everything disconnected and, if a job was streaming or paused, raises the
// disconnect-during-job safety notice — GRBL may still be executing the
// commands already in its 127-byte buffer (P0-B).
export function buildPortClosePatch(state: LaserState): Partial<LaserState> {
  const wasActiveJob = isActiveJob(state.streamer);
  const wasUnsafeActive =
    wasActiveJob || state.motionOperation !== null || state.controllerOperation !== null;
  const stream: StreamerState | null =
    wasActiveJob && state.streamer !== null ? disconnectStreamer(state.streamer) : state.streamer;
  return {
    connection: { kind: 'disconnected' },
    statusReport: null,
    controllerSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    // GRBL clears G92 on the reset that fires when the port closes; our cache
    // must match or the next connect shows "custom origin" against a zeroed machine.
    wcoCache: null,
    workOriginActive: false,
    // The origin is gone, so any Verified Frame is void (ADR-053 P2).
    frameVerification: null,
    motionOperation: null,
    controllerOperation: null,
    homingState: 'unknown',
    streamer: stream,
    ...(wasUnsafeActive ? { safetyNotice: disconnectDuringJobNotice() } : {}),
  };
}
