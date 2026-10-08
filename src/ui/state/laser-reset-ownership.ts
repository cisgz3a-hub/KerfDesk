import { cancel as cancelStreamer, markErrored, wipeInFlight } from '../../core/controllers/grbl';
import type { ControllerDriver } from '../../core/controllers';
import { clearCncLiveCaps } from './detected-settings-action';
import { cancelRawControllerLineWait } from './laser-connection-teardown';
import { invalidateControllerSessionEvidence } from './laser-controller-evidence';
import { failedControllerQualificationPatch } from './laser-controller-qualification';
import {
  cancelControllerLifecycleRefs,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import { cancelResetCleanup, type ResetCleanupRefs } from './laser-reset-cleanup';
import { writeFailedNotice, type LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import type { TranscriptSource } from './laser-transcript';
import { liveCanvasLifecyclePatch } from './live-canvas-run';
import {
  isProvisionalResetFreeze,
  provisionalResetCanvasPatch,
} from './laser-reset-terminal-state';
import { frameProofReset } from './laser-session-reset';
import { publishControllerIncident } from './laser-incident-publish';
import {
  canonicalRecoveryForReset,
  hasCoordinatedControllerReset,
  ownsResetOperation,
} from './laser-owned-reset-recovery';

export type ResetSetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
export type ResetWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;
export const DISCONNECT_WRITE_TIMEOUT_MS = 500;
export const RESET_OWNERSHIP_UNCONFIRMED =
  'The controller reset was not confirmed. Earlier command replies still have uncertain ownership. Reconnect to recover controller information, or wait for a controller reboot.';

export type ResetOwnership = {
  readonly connection: unknown;
  readonly refs: ResetTransactionRefs;
  readonly set: ResetSetFn;
  readonly operation: NonNullable<LaserState['controllerOperation']>;
  readonly writeEpoch: number;
  readonly oldResponseDebt: boolean;
  canonicalWake: boolean;
  boundaryObserved: boolean;
  resetAccepted: boolean;
  cleanupBoundaryUncertain: boolean;
  cleanupComplete: boolean;
  cleanupWrite: ResetWriteFn;
  unconfirmedCleanup: Promise<unknown | null> | null;
  attemptUnconfirmedCleanup: () => Promise<unknown | null>;
  finishCleanup: () => Promise<unknown | null>;
};

export type ResetTransactionRefs = ControllerLifecycleRefs &
  ResetCleanupRefs & {
    readonly connection?: unknown | null;
    readonly driver: ControllerDriver;
    readonly settingsCollector?: { readonly kind: string };
    onLineArrived?: (() => void) | null;
  };

export function claimResetOwnership(
  connection: unknown,
  set: ResetSetFn,
  refs: ResetTransactionRefs,
  quarantineStreamer = false,
): ResetOwnership {
  let oldResponseDebt =
    refs.controllerCommand !== null ||
    refs.settingsCollector?.kind === 'collecting' ||
    refs.onLineArrived != null;
  clearCncLiveCaps();
  cancelResetCleanup(refs);
  let operation: NonNullable<LaserState['controllerOperation']> = {
    kind: 'recovery',
    phase: 'reset',
    idleReports: 0,
  };
  let canonicalWake = false;
  set((state) => {
    const continuation = canonicalRecoveryForReset(state, refs);
    canonicalWake = continuation !== null;
    if (continuation !== null) operation = continuation;
    const idleWait = canonicalWake ? refs.controllerIdleWait : null;
    if (idleWait !== null) refs.controllerIdleWait = null;
    cancelControllerLifecycleRefs(refs, 'Controller abort requested.');
    if (idleWait !== null) refs.controllerIdleWait = idleWait;
    // A host epoch quarantines old transport callbacks; it proves no reboot.
    refs.writeEpoch = (refs.writeEpoch ?? 0) + 1;
    cancelRawControllerLineWait(refs);
    oldResponseDebt ||= stateHasResetResponseDebt(state);
    return {
      ...invalidateControllerSessionEvidence(state),
      // Only a recognized reboot may erase earlier response ownership.
      streamer:
        state.streamer === null
          ? null
          : quarantineStreamer
            ? wipeInFlight(cancelStreamer(state.streamer))
            : markErrored(state.streamer),
      ...(quarantineStreamer
        ? liveCanvasLifecyclePatch(state, 'stopped')
        : isProvisionalResetFreeze({ ...state, controllerOperation: operation }, 'errored')
          ? provisionalResetCanvasPatch(state)
          : liveCanvasLifecyclePatch(state, 'errored')),
      controllerOperation: operation,
      probeBusy: false,
      // The reset owner abandons all further interactive motion dispatch.
      // Its old acknowledgement ledger remains until a recognized reboot.
      motionOperation: null,
      ...frameProofReset(),
    };
  });
  return {
    connection,
    refs,
    set,
    operation,
    writeEpoch: refs.writeEpoch ?? 0,
    oldResponseDebt,
    canonicalWake,
    boundaryObserved: false,
    resetAccepted: false,
    cleanupBoundaryUncertain: false,
    cleanupComplete: false,
    cleanupWrite: async () => undefined,
    unconfirmedCleanup: null,
    attemptUnconfirmedCleanup: () => Promise.resolve(null),
    finishCleanup: () => Promise.resolve(null),
  };
}

function stateHasResetResponseDebt(state: LaserState): boolean {
  return (
    (state.streamer?.inFlight.length ?? 0) > 0 ||
    state.pendingUntrackedAcks > 0 ||
    (state.pendingTransportWrites ?? 0) > 0 ||
    hasCoordinatedControllerReset(state.controllerOperation)
  );
}

export function acceptOwnedResetWrite(owner: ResetOwnership, keepErroredStreamer: boolean): void {
  if (keepErroredStreamer || owner.refs.connection !== owner.connection) return;
  if (!owner.resetAccepted && !owner.boundaryObserved) return;
  owner.set((state) =>
    ownsResetOperation(state, owner.operation)
      ? {
          streamer: state.streamer === null ? null : cancelStreamer(state.streamer),
          ...liveCanvasLifecyclePatch(state, 'stopped'),
        }
      : {},
  );
}

/** A rejected or timed-out reset is a real transport fault; it cannot publish
 * an accepted stopped outcome. Preserve an earlier factual notice. */
export function failOwnedResetWrite(
  owner: ResetOwnership,
  action: LaserSafetyAction,
  error?: unknown,
): void {
  if (owner.refs.connection !== owner.connection || owner.boundaryObserved) return;
  owner.set((state) =>
    ownsResetOperation(state, owner.operation)
      ? {
          ...ownedResetFailureIncident(
            owner,
            state,
            '[lf2] Controller reset write failed: ' +
              (error instanceof Error
                ? error.message
                : error === undefined
                  ? writeFailedNotice(action).message
                  : String(error)),
          ),
          ...liveCanvasLifecyclePatch(state, 'errored'),
          ...(state.safetyNotice === null ||
          state.safetyNotice.kind === 'cnc-transition-unconfirmed'
            ? { safetyNotice: writeFailedNotice(action) }
            : {}),
        }
      : {},
  );
}

export { armOwnedResetCleanup } from './laser-owned-reset-cleanup';

export function failOwnedResetInformation(owner: ResetOwnership, message: string): void {
  if (owner.refs.connection !== owner.connection) return;
  owner.set((state) =>
    ownsResetOperation(state, owner.operation)
      ? {
          ...ownedResetFailureIncident(
            owner,
            state,
            '[lf2] Controller reset information failed: ' + message,
          ),
          ...failedControllerQualificationPatch(state, state.controllerSessionEpoch, message),
        }
      : {},
  );
}

const recordedResetFailures = new WeakMap<ResetOwnership, Set<string>>();

/** A deadline failure can precede the transport promise settling. Retain that
 * owned occurrence once, without allowing late or replaced reset callbacks to
 * publish into a later session. The caller checks connection/operation ownership. */
function ownedResetFailureIncident(
  owner: ResetOwnership,
  state: LaserState,
  message: string,
): Partial<LaserState> {
  const recorded = recordedResetFailures.get(owner) ?? new Set<string>();
  if (recorded.has(message)) return {};
  recorded.add(message);
  recordedResetFailures.set(owner, recorded);
  return publishControllerIncident(owner.refs, state, message);
}

export async function writeResetWithinDeadline(
  connection: unknown,
  refs: ResetTransactionRefs,
  safeWrite: ResetWriteFn,
  line: string,
  action: LaserSafetyAction,
): Promise<void> {
  if (refs.connection !== connection)
    throw new Error('Serial connection changed during controller reset.');
  const write = safeWrite(line, action, 'system');
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error === undefined) resolve();
      else reject(error instanceof Error ? error : new Error(String(error)));
    };
    const timer = setTimeout(() => {
      finish(new Error('Serial write timed out during controller reset.'));
    }, DISCONNECT_WRITE_TIMEOUT_MS);
    void write.then(
      () => finish(),
      (error: unknown) => finish(error),
    );
  });
}
