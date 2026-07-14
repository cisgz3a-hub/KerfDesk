import type { ControllerDriver } from '../../core/controllers';
import {
  startControllerCommand,
  waitForFreshIdle,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import { controllerErrorNotice, type LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { assertAutofocusIdle, pushLog, setupCommandBlockMessage } from './laser-store-helpers';
import type { TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;
type HomeEpochs = {
  readonly session: number;
  readonly write: number;
  readonly position: number;
};

// GRBL acks $H only after the homing cycle physically completes — commonly
// 10-60 s on real beds, so the default 8 s ack budget reports a spurious
// "home timed out" while the machine is still homing. With the
// non-idle-status-activity mode the <Home|...> poll replies keep the command
// alive, so this budget only measures status silence; on firmwares whose
// status polling pauses during a pending command (Marlin) it must cover the
// whole cycle.
const HOME_COMMAND_TIMEOUT_MS = 120_000;

function assertHomeReady(set: SetFn, get: GetFn, driver: ControllerDriver): string {
  assertAutofocusIdle(get());
  const homeCommand = driver.commands.home;
  if (homeCommand === null) throw new Error('This controller has no homing command.');
  const blockedMessage = setupCommandBlockMessage(get());
  if (blockedMessage === null) return homeCommand;
  set({
    lastWriteError: blockedMessage,
    log: pushLog(get(), `[lf2] Home command blocked: ${blockedMessage}`),
  });
  throw new Error(blockedMessage);
}

export async function runHomeAction(
  set: SetFn,
  get: GetFn,
  refs: ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
  driver: ControllerDriver,
): Promise<void> {
  const homeCommand = assertHomeReady(set, get, driver);
  const expectedSessionEpoch = get().controllerSessionEpoch;
  const expectedWriteEpoch = refs.writeEpoch ?? 0;
  let expectedPositionEpoch = 0;
  set((state) => ({
    controllerOperation: { kind: 'home', phase: 'command', idleReports: 0 },
    homingState: 'homing',
    homingProof: null,
    statusReport: null,
    statusObservation: null,
    trustedPositionEpoch: (expectedPositionEpoch = (state.trustedPositionEpoch ?? 0) + 1),
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
    wcoCache: null,
    workOriginActive:
      state.workOriginSource === 'g54-persistent' || state.workOriginSource === 'unknown',
    workOriginSource:
      state.workOriginSource === 'g54-persistent' || state.workOriginSource === 'unknown'
        ? 'unknown'
        : 'none',
    // Homing re-establishes machine zero, so any prior G92 Z0 now points at a
    // different physical height — work Z0 must be re-set (Codex audit P1).
    workZZeroEvidence: null,
    frameVerification: null,
    log: pushLog(state, '[lf2] Homing started. Cleared origin and frame verification.'),
  }));
  const epochs = {
    session: expectedSessionEpoch,
    write: expectedWriteEpoch,
    position: expectedPositionEpoch,
  };
  try {
    await executeHomeSequence(set, get, refs, safeWrite, driver, homeCommand, epochs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordHomeFailure(set, message, epochs);
    throw err;
  }
}

async function executeHomeSequence(
  set: SetFn,
  get: GetFn,
  refs: ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
  driver: ControllerDriver,
  homeCommand: string,
  epochs: HomeEpochs,
): Promise<void> {
  await startControllerCommand(refs, safeWrite, {
    kind: 'home',
    label: 'home',
    command: `${homeCommand}\n`,
    action: 'home',
    source: 'motion',
    timeoutMs: HOME_COMMAND_TIMEOUT_MS,
    timeoutMode: 'non-idle-status-activity',
  });
  assertHomeCurrent(get(), refs, epochs);
  set({ controllerOperation: { kind: 'home', phase: 'settling', idleReports: 0 } });
  await startControllerCommand(refs, safeWrite, {
    kind: 'home',
    label: 'home settle marker',
    command: `${driver.commands.settleDwell}\n`,
    action: 'home',
    source: 'system',
  });
  assertHomeCurrent(get(), refs, epochs);
  set({ controllerOperation: { kind: 'home', phase: 'awaiting-idle', idleReports: 0 } });
  await waitForFreshIdle(refs, { kind: 'home', requiredReports: 1 });
  assertHomeCurrent(get(), refs, epochs);
  confirmHome(set, get, epochs);
}

function confirmHome(set: SetFn, get: GetFn, epochs: HomeEpochs): void {
  const observation = get().statusObservation;
  if (
    get().statusReport?.state !== 'Idle' ||
    observation === null ||
    observation.sessionEpoch !== epochs.session ||
    observation.positionEpoch !== epochs.position
  )
    throw new Error('Home finished without fresh session-bound Idle settlement evidence.');
  set((state) => ({
    controllerOperation: null,
    homingState: 'confirmed',
    homingProof: {
      sessionEpoch: epochs.session,
      positionEpoch: epochs.position,
      confirmedStatusSequence: observation.sequence,
    },
    alarmCode: null,
    log: pushLog(state, '[lf2] Homing confirmed after fresh Idle.'),
  }));
}

function recordHomeFailure(set: SetFn, message: string, epochs: HomeEpochs): void {
  set((state) => {
    if (
      state.controllerOperation?.kind !== 'home' ||
      state.controllerSessionEpoch !== epochs.session ||
      (state.trustedPositionEpoch ?? 0) !== epochs.position
    )
      return {};
    return {
      controllerOperation: null,
      homingState: 'unknown',
      homingProof: null,
      lastWriteError: message,
      safetyNotice: state.safetyNotice ?? controllerErrorNotice(null, 'command', message),
      log: pushLog(state, `[lf2] Home failed: ${message}`),
    };
  });
}

function assertHomeCurrent(
  state: LaserState,
  refs: ControllerLifecycleRefs,
  epochs: HomeEpochs,
): void {
  if (
    state.controllerOperation?.kind !== 'home' ||
    state.controllerSessionEpoch !== epochs.session ||
    (refs.writeEpoch ?? 0) !== epochs.write ||
    (state.trustedPositionEpoch ?? 0) !== epochs.position
  ) {
    throw new Error('Home evidence was invalidated before confirmation.');
  }
}
