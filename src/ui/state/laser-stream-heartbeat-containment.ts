import { markErrored } from '../../core/controllers/grbl';
import type { LaserSafetyAction } from './laser-safety-notice';
import {
  acknowledgementStalledNotice,
  streamStalledNotice,
  writeFailedNotice,
} from './laser-safety-notice';
import { noResetStopLines, driverQuickStops, quickStopPatch } from './laser-quick-stop';
import { frameProofReset } from './laser-session-reset';
import type { LaserState, LiveRefs } from './laser-store';
import type { TranscriptSource } from './laser-transcript';
import {
  closeConnectionOnce,
  isIntentionalDisconnectClaimed,
  teardownConnectionRefs,
} from './laser-connection-teardown';
import { isGrblFamilyDriver, runGrblDisconnectTransaction } from './laser-disconnect-transaction';
import { buildPortClosePatch, isActiveJob } from './laser-store-helpers';
import { detectActiveStreamHeartbeatLoss } from './laser-stream-heartbeat';
import { liveCanvasLifecyclePatch } from './live-canvas-run';
import { publishControllerIncident } from './laser-incident-publish';
import {
  controllerIncidentContext,
  type ControllerIncidentContext,
} from './controller-incident-context';
import { streamResetRecord } from './job-stop-request';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

export type StreamWriteOwner = {
  readonly controllerSessionEpoch: number;
  readonly streamerEpoch: number;
};

export function streamWriteOwner(state: LaserState): StreamWriteOwner {
  return {
    controllerSessionEpoch: state.controllerSessionEpoch,
    streamerEpoch: state.streamerEpoch,
  };
}

/** A responsive controller may hold its program temporarily. Only the
 * existing dwell/busy-aware hold watchdog calls this at its full notice
 * deadline. Freeze first; recover on the same port when a reset is supported. */
export function containStalledStreamAcknowledgements(
  set: SetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): void {
  let stopped: LaserState | null = null;
  const resetRequested = isGrblFamilyDriver(refs.driver) && refs.driver.realtime.softReset !== null;
  const notice = acknowledgementStalledNotice(resetRequested);
  set((state) => {
    if (state.streamer?.status !== 'streaming') return {};
    stopped = state;
    return {
      ...publishControllerIncident(refs, state, notice.message),
      streamer: markErrored(state.streamer),
      ...(resetRequested ? { streamReset: streamResetRecord(state) } : {}),
      safetyNotice: state.safetyNotice ?? notice,
      ...liveCanvasLifecyclePatch(state, 'errored'),
      ...frameProofReset(),
    };
  });
  if (stopped === null || refs.connection === null) return;
  if (resetRequested) {
    void runGrblDisconnectTransaction(set, refs, safeWrite, {
      retainConnection: true,
      action: 'stop',
    }).catch(() => undefined);
  } else void requestQueuedStallStop(set, refs, safeWrite, stopped);
}

async function requestQueuedStallStop(
  set: SetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  state: LaserState,
): Promise<void> {
  const connection = refs.connection;
  const epoch = state.streamerEpoch;
  try {
    for (const line of noResetStopLines(refs.driver, state)) {
      if (refs.connection !== connection) return;
      await safeWrite(line, 'stop', 'system');
    }
    if (driverQuickStops(refs.driver))
      set((current) => (current.streamerEpoch === epoch ? quickStopPatch(current) : {}));
  } catch {
    // Keep the original acknowledgement-loss incident and physical-stop
    // guidance; transport rejection is also recorded by safeWrite.
  }
}

export function containLostStreamHeartbeat(
  set: SetFn,
  state: LaserState,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): boolean {
  if (!isGrblFamilyDriver(refs.driver)) {
    refs.heartbeatProbe = null;
    return false;
  }
  const heartbeat = detectActiveStreamHeartbeatLoss(
    state.streamer,
    state.statusObservation,
    refs.heartbeatProbe,
    Date.now(),
  );
  refs.heartbeatProbe = heartbeat.probe;
  if (!heartbeat.lost) return false;
  set((current) => ({
    ...publishControllerIncident(refs, current, streamStalledNotice().message),
    safetyNotice: current.safetyNotice ?? streamStalledNotice(),
    streamReset: streamResetRecord(current),
  }));
  // Freeze synchronously, then quarantine after the bounded reset transaction
  // so a late banner/ok cannot enter a future job.
  const connection = refs.connection;
  if (connection !== null) void quarantineStreamFault(set, refs, safeWrite, connection);
  return true;
}

/** Route an active-job transport rejection through the same bounded reset and
 * port quarantine used by heartbeat loss. Narrow handler harnesses omit the
 * live serial fields; production store refs carry the complete shape. */
export function containActiveStreamWriteFailure(
  set: SetFn,
  refs: object,
  safeWrite: SafeWriteFn,
  action: LaserSafetyAction,
  owner: StreamWriteOwner,
): void {
  let shouldQuarantine = false;
  const resetsController = isLiveRefs(refs) && isGrblFamilyDriver(refs.driver);
  set((state) => {
    if (!streamWriteOwnerMatches(state, owner)) return state;
    if (!isActiveJob(state.streamer) || state.streamer === null) return state;
    shouldQuarantine = true;
    return {
      ...(isLiveRefs(refs)
        ? publishControllerIncident(
            refs,
            state,
            `[lf2] Active job transport write failed: ${writeFailedNotice(action).message}`,
          )
        : {}),
      streamer: markErrored(state.streamer),
      ...(resetsController ? { streamReset: streamResetRecord(state) } : {}),
      safetyNotice: state.safetyNotice ?? writeFailedNotice(action),
      ...liveCanvasLifecyclePatch(state, 'errored'),
    };
  });
  // onClose or an earlier reset may already own this failure. Never resurrect
  // a disconnected/cancelled stream or start a second teardown around it.
  if (!shouldQuarantine) return;
  if (!isLiveRefs(refs) || !isGrblFamilyDriver(refs.driver)) return;
  const connection = refs.connection;
  if (connection !== null) void quarantineStreamFault(set, refs, safeWrite, connection);
}

function streamWriteOwnerMatches(state: LaserState, owner: StreamWriteOwner): boolean {
  return (
    state.controllerSessionEpoch === owner.controllerSessionEpoch &&
    state.streamerEpoch === owner.streamerEpoch
  );
}

async function quarantineStreamFault(
  set: SetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  connection: NonNullable<LiveRefs['connection']>,
): Promise<void> {
  let closeContext: ControllerIncidentContext | undefined;
  let retiredWriteEpoch: number | undefined;
  try {
    await runGrblDisconnectTransaction(set, refs, safeWrite);
  } catch (error) {
    if (refs.connection === connection) {
      set((state) => ({
        ...disconnectFailureIncident(refs, state, error),
        safetyNotice: writeFailedNotice('disconnect'),
      }));
    }
  } finally {
    // An explicit Disconnect joining this reset owns final state clearing.
    if (!isIntentionalDisconnectClaimed(refs, connection)) {
      if (refs.connection === connection) {
        const contextRefs = {
          writeEpoch: refs.writeEpoch ?? 0,
          ...(refs.jobTransportWrites === undefined
            ? {}
            : { jobTransportWrites: refs.jobTransportWrites }),
        };
        teardownConnectionRefs(refs);
        retiredWriteEpoch = refs.writeEpoch;
        set((state) => {
          closeContext = controllerIncidentContext(state, contextRefs);
          const patch = buildPortClosePatch(state);
          return state.safetyNotice === null
            ? patch
            : { ...patch, safetyNotice: state.safetyNotice };
        });
      }
      await closeConnectionOnce(refs, connection).catch((error: unknown) => {
        // A later Connect/Forget owns its new facts; a retired close cannot pollute it.
        if (
          retiredWriteEpoch === undefined ||
          refs.writeEpoch !== retiredWriteEpoch ||
          refs.connection !== null
        )
          return;
        const message = error instanceof Error ? error.message : String(error);
        const raw = `[lf2] Contained controller close failed: ${message}`;
        set((state) =>
          publishControllerIncident(refs, state, raw, 'disconnect', raw, closeContext),
        );
      });
    }
  }
}

function disconnectFailureIncident(
  refs: LiveRefs,
  state: LaserState,
  error: unknown,
): Partial<LaserState> {
  const message = error instanceof Error ? error.message : String(error);
  return publishControllerIncident(
    refs,
    state,
    `[lf2] Controller stop before disconnect failed: ${message}`,
  );
}

function isLiveRefs(refs: object): refs is LiveRefs {
  return [
    'connection',
    'driver',
    'unsubscribeLine',
    'unsubscribeClose',
    'pollHandle',
    'settingsCollector',
    'settingsCollectorSessionEpoch',
    'onLineArrived',
    'nextTranscriptId',
    'stallProbe',
    'heartbeatProbe',
    'closeRequests',
    'intentionalDisconnects',
    'forgetFinalizations',
    'controllerCommand',
    'controllerIdleWait',
    'controllerResetWait',
    'controllerStatusWait',
    'pauseResumeTransition',
    'pendingResetCleanup',
  ].every((key) => key in refs);
}
