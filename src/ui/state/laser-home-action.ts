import type { ControllerDriver } from '../../core/controllers';
import {
  startControllerCommand,
  waitForFreshIdle,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import { controllerErrorNotice, type LaserSafetyAction } from './laser-safety-notice';
import { hasPendingControllerWrite } from './laser-start-queue-fence';
import type { LaserState } from './laser-store';
import {
  assertAutofocusIdle,
  mpgCommandBlockMessage,
  pushLog,
  setupCommandBlockMessage,
} from './laser-store-helpers';
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
  readonly operationId: number;
};

type HomeOperation = Extract<NonNullable<LaserState['controllerOperation']>, { kind: 'home' }>;

let nextHomeOperationId = 1;

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
  const state = get();
  const mpgBlocked = mpgCommandBlockMessage(state);
  if (mpgBlocked !== null) blockHome(set, get, mpgBlocked);
  if (hasPendingControllerWrite(get())) {
    const message =
      'Home is blocked until the previous controller write and terminal acknowledgement settle.';
    blockHome(set, get, message);
  }
  const controllerState = state.statusReport?.state ?? null;
  const alarmRecoveryKnown =
    controllerState === 'Alarm' || (controllerState === null && state.alarmCode !== null);
  if (controllerState !== 'Idle' && !alarmRecoveryKnown) {
    blockHome(
      set,
      get,
      `Machine must be known Idle or Alarm before homing (currently ${controllerState ?? 'unknown'}).`,
    );
  }
  const blockedMessage = setupCommandBlockMessage(get());
  if (blockedMessage === null) return homeCommand;
  blockHome(set, get, blockedMessage);
}

function blockHome(set: SetFn, get: GetFn, message: string): never {
  set({
    lastWriteError: message,
    log: pushLog(get(), `[lf2] Home command blocked: ${message}`),
  });
  throw new Error(message);
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
  const operationId = nextHomeOperationId++;
  let expectedPositionEpoch = 0;
  set((state) => ({
    controllerOperation: homeOperation(operationId, 'command'),
    homingState: 'homing',
    homingProof: null,
    positionEvidenceSuppressed: true,
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
    framedRun: null,
    log: pushLog(state, '[lf2] Homing started. Cleared origin and frame verification.'),
  }));
  const epochs = {
    session: expectedSessionEpoch,
    write: expectedWriteEpoch,
    position: expectedPositionEpoch,
    operationId,
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
  set({ controllerOperation: homeOperation(epochs.operationId, 'settling') });
  await startControllerCommand(refs, safeWrite, {
    kind: 'home',
    label: 'home settle marker',
    command: `${driver.commands.settleDwell}\n`,
    action: 'home',
    source: 'system',
  });
  assertHomeCurrent(get(), refs, epochs);
  set({ controllerOperation: homeOperation(epochs.operationId, 'awaiting-idle') });
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
    positionEvidenceSuppressed: false,
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
      state.controllerOperation.operationId !== epochs.operationId ||
      state.controllerSessionEpoch !== epochs.session
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
    state.controllerOperation.operationId !== epochs.operationId ||
    state.controllerSessionEpoch !== epochs.session ||
    (refs.writeEpoch ?? 0) !== epochs.write ||
    (state.trustedPositionEpoch ?? 0) !== epochs.position
  ) {
    throw new Error('Home evidence was invalidated before confirmation.');
  }
}

function homeOperation(operationId: number, phase: HomeOperation['phase']): HomeOperation {
  return { kind: 'home', phase, idleReports: 0, operationId };
}
