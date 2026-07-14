import type { SerialConnection } from '../../platform/types';
import {
  cancelControllerLifecycleRefs,
  waitForFreshIdle,
  waitForControllerResetBoundary,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import { invalidProbeEvidence } from './laser-probe-policy';
import { describeProbeResult, type ProbeResult } from './probe-actions';
import { controllerErrorNotice, type LaserSafetyAction } from './laser-safety-notice';
import { pushLog } from './laser-store-helpers';
import type { LaserState } from './laser-store';
import { invalidateControllerSessionEvidence } from './laser-controller-evidence';
import type { TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type RecoveryRefs = ControllerLifecycleRefs & {
  readonly connection: SerialConnection | null;
  readonly driver: { readonly realtime: { readonly softReset: string | null } };
};
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

const RECOVERY_IDLE_REPORTS = 2;

export async function failProbeTransaction(
  set: SetFn,
  get: GetFn,
  refs: RecoveryRefs,
  safeWrite: SafeWriteFn,
  connection: SerialConnection,
  transactionId: number,
  result: Exclude<ProbeResult, { readonly kind: 'ok' }>,
  pendingLine: string,
): Promise<void> {
  const described = describeProbeResult(result);
  const alarmFailure = result.kind === 'probe-failed' || result.kind === 'alarm';
  if (!isCurrentProbe(get(), transactionId)) {
    finishGloballyHandledAlarm(set, refs, connection, result, described.message);
    return;
  }
  const disconnected = refs.connection !== connection || get().connection.kind !== 'connected';
  markProbeFailed(set, transactionId, result, pendingLine, described.message, disconnected);
  if (alarmFailure || disconnected) return;
  await recoverUncertainProbe(
    set,
    get,
    refs,
    safeWrite,
    connection,
    transactionId,
    described.message,
  );
}

function finishGloballyHandledAlarm(
  set: SetFn,
  refs: RecoveryRefs,
  connection: SerialConnection,
  result: Exclude<ProbeResult, { readonly kind: 'ok' }>,
  message: string,
): void {
  if ((result.kind !== 'probe-failed' && result.kind !== 'alarm') || refs.connection !== connection)
    return;
  set({
    workZZeroEvidence: null,
    probeBusy: false,
    alarmCode: result.alarmCode,
    lastWriteError: message,
  });
}

function markProbeFailed(
  set: SetFn,
  transactionId: number,
  result: Exclude<ProbeResult, { readonly kind: 'ok' }>,
  pendingLine: string,
  message: string,
  disconnected: boolean,
): void {
  const alarmFailure = result.kind === 'probe-failed' || result.kind === 'alarm';
  set((state) => {
    const operation = state.controllerOperation;
    if (operation?.kind !== 'probe' || operation.transactionId !== transactionId) return {};
    return {
      ...invalidProbeEvidence(operation.affectsXy),
      statusReport: null,
      ...(alarmFailure ? { alarmCode: result.alarmCode } : {}),
      lastWriteError: message,
      safetyNotice:
        state.safetyNotice ?? controllerErrorNotice(null, 'command', message, pendingLine),
      log: pushLog(state, `[lf2] Probe transaction ${transactionId} failed: ${message}`),
      ...(alarmFailure || disconnected
        ? { controllerOperation: null, probeBusy: false }
        : {
            controllerOperation: {
              kind: 'probe',
              phase: 'recovering',
              idleReports: 0,
              transactionId,
              affectsXy: operation.affectsXy,
            },
            probeBusy: true,
          }),
    };
  });
}

async function recoverUncertainProbe(
  set: SetFn,
  get: GetFn,
  refs: RecoveryRefs,
  safeWrite: SafeWriteFn,
  connection: SerialConnection,
  transactionId: number,
  failureMessage: string,
): Promise<void> {
  const softReset = refs.driver.realtime.softReset;
  if (softReset === null) return;
  const resetEpoch = refs.writeEpoch ?? 0;
  const resetBoundary = waitForControllerResetBoundary(refs, resetEpoch);
  set((state) => invalidateControllerSessionEvidence(state));
  try {
    try {
      await safeWrite(softReset, 'probe', 'system');
    } catch (error) {
      // A very fast reboot banner advances the epoch before write() resolves;
      // that observed boundary is stronger evidence than transport resolution.
      if ((refs.writeEpoch ?? 0) === resetEpoch) {
        cancelControllerLifecycleRefs(refs, 'Probe reset write failed.');
        await resetBoundary.catch(() => undefined);
        throw error;
      }
    }
    await resetBoundary;
    markRecoveryResetSent(set, refs, transactionId);
    // Only reports observed after the controller's reboot banner qualify.
    await waitForFreshIdle(refs, { kind: 'probe', requiredReports: RECOVERY_IDLE_REPORTS });
    assertCurrentProbe(get(), refs, connection, transactionId);
    markRecoveryComplete(set, transactionId);
  } catch (error) {
    cancelControllerLifecycleRefs(refs, 'Probe recovery did not settle.');
    const message = error instanceof Error ? error.message : String(error);
    markRecoveryLocked(set, transactionId, failureMessage, message);
  }
}

function markRecoveryResetSent(set: SetFn, refs: RecoveryRefs, transactionId: number): void {
  refs.writeEpoch = (refs.writeEpoch ?? 0) + 1;
  set((state) =>
    isCurrentProbe(state, transactionId)
      ? {
          pendingUntrackedAcks: 0,
          trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
          log: pushLog(state, '[lf2] Probe recovery reset sent; waiting for fresh Idle.'),
        }
      : {},
  );
}

function markRecoveryComplete(set: SetFn, transactionId: number): void {
  set((state) =>
    isCurrentProbe(state, transactionId)
      ? {
          controllerOperation: null,
          probeBusy: false,
          log: pushLog(state, '[lf2] Probe recovery confirmed after fresh Idle.'),
        }
      : {},
  );
}

function markRecoveryLocked(
  set: SetFn,
  transactionId: number,
  failureMessage: string,
  recoveryMessage: string,
): void {
  set((state) =>
    isCurrentProbe(state, transactionId)
      ? {
          lastWriteError: `${failureMessage} Recovery remains locked: ${recoveryMessage}`,
          log: pushLog(state, `[lf2] Probe recovery remains locked: ${recoveryMessage}`),
        }
      : {},
  );
}

function assertCurrentProbe(
  state: LaserState,
  refs: RecoveryRefs,
  connection: SerialConnection,
  transactionId: number,
): void {
  if (refs.connection !== connection || !isCurrentProbe(state, transactionId)) {
    throw new Error('Probe transaction lost controller ownership.');
  }
}

function isCurrentProbe(state: LaserState, transactionId: number): boolean {
  return (
    state.controllerOperation?.kind === 'probe' &&
    state.controllerOperation.transactionId === transactionId
  );
}
