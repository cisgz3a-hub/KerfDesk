import { markErrored } from '../../core/controllers/grbl';
import type { LaserSafetyAction } from './laser-safety-notice';
import { streamStalledNotice, writeFailedNotice } from './laser-safety-notice';
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

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

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
  set((current) => ({ safetyNotice: current.safetyNotice ?? streamStalledNotice() }));
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
): void {
  let shouldQuarantine = false;
  set((state) => {
    if (!isActiveJob(state.streamer) || state.streamer === null) return state;
    shouldQuarantine = true;
    return {
      streamer: markErrored(state.streamer),
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

async function quarantineStreamFault(
  set: SetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  connection: NonNullable<LiveRefs['connection']>,
): Promise<void> {
  try {
    await runGrblDisconnectTransaction(set, refs, safeWrite);
  } catch {
    set({ safetyNotice: writeFailedNotice('disconnect') });
  } finally {
    // An explicit Disconnect joining this reset owns final state clearing.
    if (!isIntentionalDisconnectClaimed(connection)) {
      if (refs.connection === connection) {
        teardownConnectionRefs(refs);
        set((state) => {
          const patch = buildPortClosePatch(state);
          return state.safetyNotice === null
            ? patch
            : { ...patch, safetyNotice: state.safetyNotice };
        });
      }
      await closeConnectionOnce(connection).catch(() => undefined);
    }
  }
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
    'controllerCommand',
    'controllerIdleWait',
    'controllerResetWait',
    'controllerStatusWait',
    'pauseResumeTransition',
    'pendingResetCleanup',
  ].every((key) => key in refs);
}
