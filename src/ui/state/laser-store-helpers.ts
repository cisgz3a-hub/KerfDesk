// laser-store-helpers — pure factories and patch builders extracted from
// laser-store.ts to keep that file under the ADR-015 size cap. There is no
// runtime import cycle: the LaserState import below is type-only (erased at
// build), so this module depends only on the controller + safety-notice modules
// at runtime.

import {
  disconnect as disconnectStreamer,
  queuedLineCount,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import { grblDriver, type ControllerDriver } from '../../core/controllers';
import { controllerOperationCommandBlockMessage } from './laser-controller-operation';
import { disconnectDuringFireNotice, disconnectDuringJobNotice } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import {
  isWorkZEvidenceFreshForStart,
  probePlateRemovalRequired,
  PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE,
} from './work-z-zero-evidence';

const LOG_MAX = 200;
const TOOL_CHANGE_STATE_DEFAULTS = {
  toolChangeIdleSeen: false,
  toolChangeLabels: [] as ReadonlyArray<string>,
  toolChangeToolIds: [] as ReadonlyArray<string | null>,
  pendingToolLabel: null,
  pendingToolId: null,
};
const AUTOFOCUS_BUSY_MESSAGE =
  'Auto-focus is running. Wait for it to finish before sending other motion commands.';
export const ACTIVE_JOB_COMMAND_MESSAGE =
  'A job is active. Request ABORT before sending setup, jog, home, unlock, origin, settings, or autofocus commands.';
export const UNKNOWN_IDLE_STATUS_MESSAGE =
  'Controller status is not known yet. Wait for an Idle status report before jogging or framing.';
export const MOTION_OPERATION_ACTIVE_MESSAGE =
  'A jog or frame operation is active. Wait for GRBL to report Idle, or cancel the operation, before sending another motion command.';
export const FIRE_ACTIVE_COMMAND_MESSAGE =
  'Release the momentary Fire control before sending another machine command.';
export const TOOL_CHANGE_NOT_IDLE_MESSAGE =
  'Waiting for the machine to reach the tool-change position. Jog, probe, and Zero Z unlock once it reports Idle.';
export const TOOL_CHANGE_Z_ZERO_REQUIRED_MESSAGE =
  'Load the new bit, select it as the Active bit, and establish its Z zero on the stock top before continuing.';

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
  return (
    streamer !== null &&
    ['streaming', 'paused', 'tool-change', 'done', 'errored'].includes(streamer.status)
  );
}

export function activeJobCommandBlockMessage(state: LaserState): string | null {
  return isActiveJob(state.streamer) ? ACTIVE_JOB_COMMAND_MESSAGE : null;
}

// The setup-motion gate (jog, probe, Zero-Z, set origin). Identical to
// activeJobCommandBlockMessage EXCEPT during a tool-change hold, where the
// operator must touch off the new bit — but only once the machine has drained
// the pre-M0 retract/park and reports Idle. Start / Home / Setup keep the
// strict activeJobCommandBlockMessage, so Start never unblocks at a tool change.
export function setupBlockingJobCommandBlockMessage(state: LaserState): string | null {
  if (!isActiveJob(state.streamer)) return null;
  if (state.streamer?.status !== 'tool-change') return ACTIVE_JOB_COMMAND_MESSAGE;
  return toolChangeReady(state) ? null : TOOL_CHANGE_NOT_IDLE_MESSAGE;
}

// Ready to touch off the new bit only when the pre-M0 retract/park has fully
// drained (no in-flight lines still owed acks) AND a FRESH Idle has been observed
// since entering the hold. Checking statusReport.state === 'Idle' alone was
// unsafe: that Idle can be stale (the report from before Start, before the
// retract even began), so the setup gate unlocked while the machine was still
// moving (Codex audit P1).
export function toolChangeReady(state: LaserState): boolean {
  const streamer = state.streamer;
  if (streamer === null || streamer.status !== 'tool-change') return false;
  return streamer.inFlight.length === 0 && state.toolChangeIdleSeen;
}

// The state patch applied whenever a RUNNING job enters a tool-change hold: at
// the ack-driven transition (advanceStream) and when a Continue step lands
// directly in the next hold within one fill (F22). A new bit is going in, so
// void the prior tool's Z0 and bump the epoch, require a FRESH Idle before the
// setup gate / Continue unlock, and advance the pending-tool label + id to name
// the incoming bit. Both entry sites must share this so they cannot drift.
export function toolChangeHoldEntryPatch(
  state: LaserState,
): Pick<
  LaserState,
  | 'workZZeroEvidence'
  | 'workZReferenceEpoch'
  | 'toolChangeIdleSeen'
  | 'pendingToolLabel'
  | 'pendingToolId'
  | 'toolChangeLabels'
  | 'toolChangeToolIds'
> {
  return {
    workZZeroEvidence: null,
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
    toolChangeIdleSeen: false,
    pendingToolLabel: state.toolChangeLabels[0] ?? null,
    pendingToolId: state.toolChangeToolIds[0] ?? null,
    toolChangeLabels: state.toolChangeLabels.slice(1),
    toolChangeToolIds: state.toolChangeToolIds.slice(1),
  };
}

// Continue is stronger than setup readiness. Fresh Idle only proves the old
// tool's retract/park completed; the new tool must also have a freshly
// established Z zero before the emitted spindle-off clearance move can be
// trusted to target the configured safe height.
export function toolChangeContinueBlockMessage(state: LaserState): string | null {
  if (!toolChangeReady(state)) return TOOL_CHANGE_NOT_IDLE_MESSAGE;
  if (
    !isWorkZEvidenceFreshForStart(
      state.workZZeroEvidence,
      state.workZReferenceEpoch,
      state.controllerSessionEpoch,
      Date.now(),
    )
  ) {
    return TOOL_CHANGE_Z_ZERO_REQUIRED_MESSAGE;
  }
  if (probePlateRemovalRequired(state.workZZeroEvidence)) {
    return PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE;
  }
  if (state.pendingToolId !== null && state.workZZeroEvidence?.toolId !== state.pendingToolId) {
    const expected = state.pendingToolLabel ?? state.pendingToolId;
    return (
      `Work Z belongs to a different bit. Load ${expected}, select it as the Active bit, ` +
      'then touch it to the stock top and Zero Z — or probe again — before continuing.'
    );
  }
  return null;
}

// True while stream acks are still outstanding — sending or paused, or any
// in-flight line not yet acknowledged. Queued status queries (Marlin M114)
// must stay silent through THIS window (their ok would desync the ack
// accounting), but may resume once everything is acked: 'done' still blocks
// isActiveJob until the post-job settle sees Idle, and that settle NEEDS the
// M114 polls to observe Idle at all.
export function hasUnsettledStreamAcks(streamer: StreamerState | null): boolean {
  if (streamer === null) return false;
  if (streamer.status === 'streaming' || streamer.status === 'paused') return true;
  return streamer.inFlight.length > 0;
}

export function motionOperationCommandBlockMessage(state: LaserState): string | null {
  if (state.fireActive) return FIRE_ACTIVE_COMMAND_MESSAGE;
  return state.motionOperation !== null
    ? MOTION_OPERATION_ACTIVE_MESSAGE
    : controllerOperationCommandBlockMessage(state.controllerOperation);
}

export function setupCommandBlockMessage(state: LaserState): string | null {
  return activeJobCommandBlockMessage(state) ?? motionOperationCommandBlockMessage(state);
}

export function jogFrameCommandBlockMessage(state: LaserState): string | null {
  const activeJobMessage = setupBlockingJobCommandBlockMessage(state);
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

export function disconnectStopCommands(
  state: LaserState,
  driver: ControllerDriver,
): ReadonlyArray<string> {
  const fireOff = state.fireActive ? ['M5\n'] : [];
  if (isActiveJob(state.streamer) || state.controllerOperation?.kind === 'probe') {
    const softReset = driver.realtime.softReset;
    return [
      ...(softReset === null ? [] : [softReset]),
      ...fireOff,
      ...driver.commands.stopLaserLines.map((line) => `${line}\n`),
    ];
  }
  if (state.fireActive) {
    return [...fireOff, ...driver.commands.stopLaserLines.map((line) => `${line}\n`)];
  }
  if (state.airAssistOn) return driver.commands.stopLaserLines.map((line) => `${line}\n`);
  if (state.motionOperation === null) return [];
  const jogCancel = driver.realtime.jogCancel;
  return jogCancel === null ? [] : [jogCancel];
}

export function assertAutofocusIdle(state: LaserState): void {
  if (state.autofocusBusy) throw new Error(AUTOFOCUS_BUSY_MESSAGE);
}

// Guards the origin actions (Zero-Z, Set Origin). Uses the setup-motion gate,
// so re-zeroing the new bit is permitted during a settled (Idle) tool-change
// hold but blocked during any other active job.
export function assertNoActiveJob(state: LaserState): void {
  const message = setupBlockingJobCommandBlockMessage(state);
  if (message !== null) throw new Error(message);
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
      queuedCount: queuedLineCount(streamer),
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
    prev.queuedCount === queuedLineCount(streamer)
  );
}

type InitialLaserState = Pick<
  LaserState,
  | 'capabilities'
  | 'activeControllerKind'
  | 'detectedControllerKind'
  | 'connection'
  | 'statusReport'
  | 'controllerSessionEpoch'
  | 'statusSequence'
  | 'statusObservation'
  | 'alarmCode'
  | 'lastError'
  | 'lastWriteError'
  | 'safetyNotice'
  | 'airAssistOn'
  | 'fireActive'
  | 'autofocusBusy'
  | 'probeBusy'
  | 'motionOperation'
  | 'controllerOperation'
  | 'streamer'
  | 'liveCanvasRun'
  | 'activeJobMachineKind'
  | 'pendingUntrackedAcks'
  | 'pendingTransportWrites'
  | 'homingState'
  | 'homingProof'
  | 'trustedPositionEpoch'
  | 'workZReferenceEpoch'
  | 'log'
  | 'transcript'
  | 'detectedSettings'
  | 'controllerSettings'
  | 'controllerSettingsObservation'
  | 'grblSettingsRows'
  | 'lastSettingsReadAt'
  | 'wcoCache'
  | 'ovCache'
  | 'accessoryCache'
  | 'mpgActive'
  | 'workOriginActive'
  | 'workOriginSource'
  | 'workZZeroEvidence'
  | 'toolChangeIdleSeen'
  | 'toolChangeLabels'
  | 'toolChangeToolIds'
  | 'pendingToolLabel'
  | 'pendingToolId'
  | 'frameVerification'
>;

export function initialLaserState(): InitialLaserState {
  return {
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    controllerSessionEpoch: 0,
    statusSequence: 0,
    statusObservation: null,
    alarmCode: null,
    lastError: null,
    lastWriteError: null,
    safetyNotice: null,
    airAssistOn: false,
    fireActive: false,
    autofocusBusy: false,
    probeBusy: false,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    liveCanvasRun: null,
    activeJobMachineKind: null,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    homingState: 'unknown',
    homingProof: null,
    trustedPositionEpoch: 0,
    workZReferenceEpoch: 0,
    log: [],
    transcript: [],
    detectedSettings: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    wcoCache: null,
    ovCache: null,
    accessoryCache: null,
    mpgActive: null,
    workOriginActive: false,
    workOriginSource: 'none',
    workZZeroEvidence: null,
    ...TOOL_CHANGE_STATE_DEFAULTS,
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
    wasActiveJob ||
    state.fireActive ||
    state.motionOperation !== null ||
    state.controllerOperation !== null;
  const stream: StreamerState | null =
    wasActiveJob && state.streamer !== null ? disconnectStreamer(state.streamer) : state.streamer;
  return {
    connection: { kind: 'disconnected' },
    statusReport: null,
    controllerSessionEpoch: state.controllerSessionEpoch + 1,
    statusObservation: null,
    detectedSettings: null,
    detectedControllerKind: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    // GRBL clears G92 on the reset that fires when the port closes; persistent
    // G54 can survive, but the cached WCO is no longer trustworthy until a
    // fresh status frame arrives.
    wcoCache: null,
    ovCache: null,
    accessoryCache: null,
    mpgActive: null,
    workOriginActive: state.workOriginSource === 'g54-persistent',
    workOriginSource: state.workOriginSource === 'g54-persistent' ? 'unknown' : 'none',
    // The origin is gone, so any Verified Frame is void (ADR-053 P2).
    frameVerification: null,
    motionOperation: null,
    controllerOperation: null,
    probeBusy: false,
    airAssistOn: false,
    fireActive: false,
    homingState: 'unknown',
    homingProof: null,
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
    workZZeroEvidence: null,
    streamer: stream,
    ...(state.liveCanvasRun === null || state.liveCanvasRun === undefined
      ? {}
      : { liveCanvasRun: { ...state.liveCanvasRun, lifecycle: 'disconnected' as const } }),
    // Replies and transport completions owned by the dead session can no
    // longer qualify. teardown() advanced writeEpoch before this patch, so a
    // late completion is intentionally unable to mutate the new ledger.
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    ...(state.fireActive
      ? { safetyNotice: disconnectDuringFireNotice() }
      : wasUnsafeActive
        ? { safetyNotice: disconnectDuringJobNotice() }
        : {}),
  };
}
