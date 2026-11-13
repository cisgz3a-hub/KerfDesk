import { markErrored } from '../../core/controllers/grbl';
import type { LaserSafetyAction, LaserSafetyNotice } from './laser-safety-notice';
import {
  acknowledgementStalledNotice,
  controllerLink,
  readFailedDuringJobNotice,
  streamStalledNotice,
  writeFailedNotice,
} from './laser-safety-notice';
import { noResetStopLines, driverQuickStops, quickStopPatch } from './laser-quick-stop';
import { hostedRefillArmed, releaseHostedRefill } from './laser-hosted-refill';
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

/** Connections whose stall containment is waiting on the worker's refill
 * handback. The stream still reads 'streaming' meanwhile, so the status poll
 * would otherwise start a second containment on its next tick. */
const handbacksPending = new WeakSet<NonNullable<LiveRefs['connection']>>();

/** A responsive controller may hold its program temporarily. Only the
 * existing dwell/busy-aware hold watchdog calls this at its full notice
 * deadline. Freeze first; recover on the same port when a reset is supported.
 * A worker-held Marlin refill comes back before the freeze (ADR-676 Amd 4). */
export function containStalledStreamAcknowledgements(
  set: SetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): void {
  const connection = refs.connection;
  if (connection !== null && handbacksPending.has(connection)) return;
  const resetRequested = isGrblFamilyDriver(refs.driver) && refs.driver.realtime.softReset !== null;
  if (!resetRequested && connection !== null && hostedRefillArmed(refs)) {
    void containAfterHostedRefillHandback(set, refs, safeWrite, connection);
    return;
  }
  const stopped = freezeStalledStream(set, refs, resetRequested);
  if (stopped === null || refs.connection === null) return;
  if (resetRequested) {
    void runGrblDisconnectTransaction(set, refs, safeWrite, {
      retainConnection: true,
      action: 'stop',
    }).catch(() => undefined);
  } else void requestQueuedStallStop(set, refs, safeWrite, stopped);
}

/** Marks a still-streaming job errored and publishes the stall. Returns the
 * state it froze, or null when there was nothing (left) to freeze. */
function freezeStalledStream(
  set: SetFn,
  refs: LiveRefs,
  resetRequested: boolean,
  streamerEpoch?: number,
): LaserState | null {
  let stopped: LaserState | null = null;
  const notice = acknowledgementStalledNotice(resetRequested);
  set((state) => {
    if (state.streamer?.status !== 'streaming') return {};
    if (streamerEpoch !== undefined && state.streamerEpoch !== streamerEpoch) return {};
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
  return stopped;
}

function streamingState(set: SetFn): LaserState | null {
  let streaming: LaserState | null = null;
  set((state) => {
    if (state.streamer?.status === 'streaming') streaming = state;
    return state;
  });
  return streaming;
}

// Rolling audit v8 N1-P3-1, the twin of Abort and Disconnect's N1-P2-1 (ADR-676
// Amendments 1 and 4). Marking the stream errored while the worker still held
// the refill let an `ok` reaching the worker in that instant send one more job
// line this side's frozen ledger lacked; its reply then settled a stop line.
// So the release is posted first, then every stop line at once, and only the
// freeze waits for the worker's reply. Until then an `ok` steps this side's
// stream exactly as the worker's refill did. The release reply arrives as a
// microtask, so the freeze runs before the next serial line is handled.
async function containAfterHostedRefillHandback(
  set: SetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  connection: NonNullable<LiveRefs['connection']>,
): Promise<void> {
  const stalled = streamingState(set);
  if (stalled === null) return;
  handbacksPending.add(connection);
  // Capture M9 cleanup from the queue before the freeze retires it.
  const lines = noResetStopLines(refs.driver, stalled);
  const released = releaseHostedRefill(refs);
  const written = Promise.allSettled(lines.map((line) => safeWrite(line, 'stop', 'system')));
  try {
    await released;
  } catch {
    // A failed handshake leaves the worker's state unknown; freezing this
    // side is still the safe step.
  } finally {
    handbacksPending.delete(connection);
  }
  if (refs.connection !== connection) return;
  const epoch = stalled.streamerEpoch;
  if (freezeStalledStream(set, refs, false, epoch) === null) return;
  const results = await written;
  if (results.every((result) => result.status === 'fulfilled') && driverQuickStops(refs.driver))
    set((current) => (current.streamerEpoch === epoch ? quickStopPatch(current) : {}));
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
  const now = Date.now();
  const heartbeat = detectActiveStreamHeartbeatLoss(
    state.streamer,
    state.statusObservation,
    refs.heartbeatProbe,
    now,
    refs.connection?.inputReadThrough?.() ?? now,
  );
  refs.heartbeatProbe = heartbeat.probe;
  if (!heartbeat.lost) return false;
  set((current) => {
    const stalled = streamStalledNotice(controllerLink(current));
    return {
      ...publishControllerIncident(refs, current, stalled.message),
      safetyNotice: current.safetyNotice ?? stalled,
      streamReset: streamResetRecord(current),
    };
  });
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
  const notice = writeFailedNotice(action);
  void containActiveStreamTransportFault(set, refs, safeWrite, owner, {
    incident: `[lf2] Active job transport write failed: ${notice.message}`,
    notice: () => notice,
  });
}

/** Routes the faults a connection reports on its own into the one containment
 * path, while it is the live connection. */
export function observeTransportFaults(
  set: SetFn,
  get: () => LaserState,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  connection: NonNullable<LiveRefs['connection']>,
): void {
  // A refill written out in the worker can fail the same way one written here
  // can, and it means the same thing: bytes for a live job may or may not have
  // reached the controller (ADR-334).
  connection.hostedStreaming?.onWriteError(() => {
    if (refs.connection !== connection) return;
    containActiveStreamWriteFailure(set, refs, safeWrite, 'stream', streamWriteOwner(get()));
  });
  // A network session whose read failed may still take writes: a running
  // job's reset goes out through it before it closes (ADR-398 Amendment 6).
  connection.beforeReadFailureClose?.(async () => {
    if (refs.connection !== connection) return;
    await containActiveStreamReadFailure(set, refs, safeWrite, streamWriteOwner(get()));
  });
}

/** A transport that can no longer read its session during a job, while the
 * session may still take writes (a desktop network read that failed), gets the
 * same bounded reset and quarantine before it closes (ADR-398 Amendment 6).
 * Resolves once that stop has settled. */
export function containActiveStreamReadFailure(
  set: SetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  owner: StreamWriteOwner,
): Promise<void> {
  return containActiveStreamTransportFault(set, refs, safeWrite, owner, {
    incident: '[lf2] Active job transport read failed; a controller reset was requested.',
    notice: (state) => readFailedDuringJobNotice(controllerLink(state)),
  });
}

function containActiveStreamTransportFault(
  set: SetFn,
  refs: object,
  safeWrite: SafeWriteFn,
  owner: StreamWriteOwner,
  fault: {
    readonly incident: string;
    readonly notice: (state: LaserState) => LaserSafetyNotice;
  },
): Promise<void> {
  let shouldQuarantine = false;
  const resetsController = isLiveRefs(refs) && isGrblFamilyDriver(refs.driver);
  set((state) => {
    if (!streamWriteOwnerMatches(state, owner)) return state;
    if (!isActiveJob(state.streamer) || state.streamer === null) return state;
    shouldQuarantine = true;
    return {
      ...(isLiveRefs(refs) ? publishControllerIncident(refs, state, fault.incident) : {}),
      streamer: markErrored(state.streamer),
      ...(resetsController ? { streamReset: streamResetRecord(state) } : {}),
      safetyNotice: state.safetyNotice ?? fault.notice(state),
      ...liveCanvasLifecyclePatch(state, 'errored'),
    };
  });
  // onClose or an earlier reset may already own this failure. Never resurrect
  // a disconnected/cancelled stream or start a second teardown around it.
  if (!shouldQuarantine) return Promise.resolve();
  if (!isLiveRefs(refs) || !isGrblFamilyDriver(refs.driver)) return Promise.resolve();
  const connection = refs.connection;
  return connection === null
    ? Promise.resolve()
    : quarantineStreamFault(set, refs, safeWrite, connection);
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
        // The job's own fault notice says what stopped the job, and a failed
        // off line after the reset has added itself to it. Replacing it with
        // "the disconnect command was not written" hid both (CNC audit v3
        // N5-P3-3, ADR-398 Amendment 10).
        safetyNotice: state.safetyNotice ?? writeFailedNotice('disconnect'),
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
