import type { ControllerDriver } from '../../core/controllers';
import {
  ControllerCommandRefusedError,
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
  /** Position evidence was already suppressed (for example after an unlock or
   * a motor release) before this Home suppressed it. */
  readonly positionSuppressedBefore: boolean;
};

type HomeOperation = Extract<NonNullable<LaserState['controllerOperation']>, { kind: 'home' }>;
type HomeReadiness = { readonly homeCommand: string; readonly fromAlarm: boolean };

let nextHomeOperationId = 1;

// GRBL acks $H only after the homing cycle physically completes — commonly
// 10-60 s on real beds, so the default 8 s ack budget reports a spurious
// "home timed out" while the machine is still homing. With the
// non-idle-status-activity mode the <Home|...> poll replies keep the command
// alive, so this budget only measures status silence; on firmwares whose
// status polling pauses during a pending command (Marlin) it must cover the
// whole cycle.
const HOME_COMMAND_TIMEOUT_MS = 120_000;

function assertHomeReady(set: SetFn, get: GetFn, driver: ControllerDriver): HomeReadiness {
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
  if (blockedMessage === null) return { homeCommand, fromAlarm: alarmRecoveryKnown };
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
  const { homeCommand, fromAlarm } = assertHomeReady(set, get, driver);
  const expectedSessionEpoch = get().controllerSessionEpoch;
  const expectedWriteEpoch = refs.writeEpoch ?? 0;
  const operationId = nextHomeOperationId++;
  const positionSuppressedBefore = get().positionEvidenceSuppressed === true;
  let expectedPositionEpoch = 0;
  set((state) => ({
    controllerOperation: homeOperation(operationId, 'command', fromAlarm),
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
    frameTrace: null,
    log: pushLog(state, '[lf2] Homing started. Cleared origin and frame verification.'),
  }));
  const epochs = {
    session: expectedSessionEpoch,
    write: expectedWriteEpoch,
    position: expectedPositionEpoch,
    operationId,
    positionSuppressedBefore,
  };
  try {
    await executeHomeSequence(set, get, refs, safeWrite, driver, homeCommand, epochs);
  } catch (err) {
    recordHomeFailure(set, err, epochs);
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
  // Vendor Home sequences can contain one command per axis. Each line must
  // earn its own terminal acknowledgement before the next line is dispatched;
  // the first axis's ok must never authorize the final settlement marker.
  for (const command of homeCommand.split(/\r?\n/).filter((line) => line.trim() !== '')) {
    assertHomeCurrent(get(), refs, epochs);
    await startControllerCommand(refs, safeWrite, {
      kind: 'home',
      label: 'home',
      command: `${command}\n`,
      action: 'home',
      source: 'motion',
      timeoutMs: HOME_COMMAND_TIMEOUT_MS,
      timeoutMode: 'non-idle-status-activity',
    });
    assertHomeCurrent(get(), refs, epochs);
  }
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

function recordHomeFailure(set: SetFn, error: unknown, epochs: HomeEpochs): void {
  const message = error instanceof Error ? error.message : String(error);
  set((state) => {
    if (state.controllerSessionEpoch !== epochs.session) return {};
    const operation = state.controllerOperation;
    if (operation?.kind !== 'home' || operation.operationId !== epochs.operationId) {
      // An ALARM line or Alarm/Sleep report already invalidated this Home and
      // cleared its owner. Still leave a record, or the failure is silent.
      return operation === null ? { log: pushLog(state, `[lf2] Home failed: ${message}`) } : {};
    }
    return {
      controllerOperation: null,
      homingState: 'unknown',
      homingProof: null,
      ...refusedHomePositionPatch(state, operation, error, epochs),
      lastWriteError: message,
      safetyNotice: state.safetyNotice ?? controllerErrorNotice(null, 'command', message),
      log: pushLog(state, `[lf2] Home failed: ${message}`),
    };
  });
}

// KD-HOME-03/04 hides status positions after a failed Home because the cycle
// may have stopped anywhere. A Home line the controller refused with error:N
// never started a cycle: GRBL-family firmware rejects $H/$HX at parse or
// validation time (for example error:3 when HOMING_SINGLE_AXIS_COMMANDS is not
// compiled in, error:5 with homing disabled), so the positions the controller
// keeps reporting are its real ones. Blanking them left the DRO empty and
// Frame unable to find a position until a reconnect, re-home or Set origin
// (audit regressions-2). The homing proof stays void, the epoch advance keeps
// any report from before the attempt from counting as fresh, and a suppression
// that predates this Home (unlock, motor release) is left in place.
function refusedHomePositionPatch(
  state: LaserState,
  operation: HomeOperation,
  error: unknown,
  epochs: HomeEpochs,
): Partial<Pick<LaserState, 'positionEvidenceSuppressed' | 'trustedPositionEpoch'>> {
  if (
    !(error instanceof ControllerCommandRefusedError) ||
    operation.phase !== 'command' ||
    epochs.positionSuppressedBefore
  ) {
    return {};
  }
  return {
    positionEvidenceSuppressed: false,
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
  };
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

function homeOperation(
  operationId: number,
  phase: HomeOperation['phase'],
  fromAlarm = false,
): HomeOperation {
  return {
    kind: 'home',
    phase,
    idleReports: 0,
    operationId,
    // Only the command phase can meet a reply generated before $H executed.
    ...(fromAlarm ? { awaitingFirstNonAlarmReport: true } : {}),
  };
}
