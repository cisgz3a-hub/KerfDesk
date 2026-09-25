import type { ControllerDriver } from '../../core/controllers';
import {
  ControllerCommandRefusedError,
  startControllerCommand,
  waitForFreshIdle,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import { grblHomingDurationBoundMs } from '../../core/controllers/grbl/grbl-homing-duration';
import {
  controllerErrorNotice,
  homeNotConfirmedNotice,
  homeUnfinishedNotice,
  type LaserSafetyAction,
  type LaserSafetyNotice,
} from './laser-safety-notice';
import { resetRequiredBlockMessage } from './controller-reset-required';
import { NO_WORK_OFFSET } from './host-recorded-origin';
import { reopenHomeAlarmReplyWindow } from './laser-home-alarm-reply';
import { requestTerminalOwnedActiveWcsReadback } from './terminal-owned-wcs-readback';
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

// Stock GRBL answers no status query while it homes, so status silence says
// nothing there. The wait is the longest cycle its own `$$` settings allow,
// with room for acceleration and startup lines, and a long backstop when the
// settings were not read; GRBL itself raises ALARM:8/9 when a switch is not
// found (controller audit 2026-09-25 ST-4).
const SILENT_HOME_MARGIN = 1.5;
const SILENT_HOME_EXTRA_MS = 30_000;
const SILENT_HOME_BACKSTOP_MS = 30 * 60_000;

function homeLineTimeoutMs(state: LaserState, driver: ControllerDriver): number {
  if (driver.capabilities.statusWhileHoming !== false) return HOME_COMMAND_TIMEOUT_MS;
  const bound = grblHomingDurationBoundMs(state.grblSettingsRows);
  if (bound === null) return SILENT_HOME_BACKSTOP_MS;
  return Math.max(HOME_COMMAND_TIMEOUT_MS, bound * SILENT_HOME_MARGIN + SILENT_HOME_EXTRA_MS);
}

const PENDING_WRITE_HOME_MESSAGE =
  'Home is blocked until the previous controller write and terminal acknowledgement settle.';

function assertHomeReady(set: SetFn, get: GetFn, driver: ControllerDriver): HomeReadiness {
  assertAutofocusIdle(get());
  const homeCommand = driver.commands.home;
  if (homeCommand === null) throw new Error('This controller has no homing command.');
  const state = get();
  const fromAlarm = alarmRecoveryKnown(state);
  const blockedMessage =
    // An MPG owns the controller, or a critical event left it accepting only a
    // soft reset (controller-reset-required.ts).
    mpgCommandBlockMessage(state) ??
    resetRequiredBlockMessage(state) ??
    (hasPendingControllerWrite(state) ? PENDING_WRITE_HOME_MESSAGE : null) ??
    homeStateBlockMessage(state, fromAlarm) ??
    setupCommandBlockMessage(state);
  if (blockedMessage === null) return { homeCommand, fromAlarm };
  blockHome(set, get, blockedMessage);
}

function alarmRecoveryKnown(state: LaserState): boolean {
  const controllerState = state.statusReport?.state ?? null;
  return controllerState === 'Alarm' || (controllerState === null && state.alarmCode !== null);
}

function homeStateBlockMessage(state: LaserState, fromAlarm: boolean): string | null {
  const controllerState = state.statusReport?.state ?? null;
  if (controllerState === 'Idle' || fromAlarm) return null;
  return `Machine must be known Idle or Alarm before homing (currently ${controllerState ?? 'unknown'}).`;
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
  refs: ControllerLifecycleRefs & { readonly driver: ControllerDriver },
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
    ...homeOriginPatch(state),
    // Homing re-establishes machine zero, so any prior G92 Z0 now points at a
    // different physical height — work Z0 must be re-set (Codex audit P1).
    workZZeroEvidence: null,
    frameVerification: null,
    framedRun: null,
    frameTrace: null,
    log: pushLog(state, '[lf2] Homing started. Invalidated origin and frame evidence.'),
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
  // A completed Home runs the controller's startup lines ($N0/$N1), which can
  // select another work coordinate system (gnea/grbl system.c:198; grblHAL
  // system.c:494-500), so the WCS is read again (controller audit 2026-09-25
  // GP-1). Non-fatal: an unread WCS is read before the next Frame selects one.
  await requestTerminalOwnedActiveWcsReadback(get, refs, safeWrite, epochs.session, 'home');
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
  const lines = homeCommand.split(/\r?\n/).filter((line) => line.trim() !== '');
  for (const [index, command] of lines.entries()) {
    assertHomeCurrent(get(), refs, epochs);
    if (index > 0) set(reopenHomeAlarmReplyWindow);
    await startControllerCommand(refs, safeWrite, {
      kind: 'home',
      label: 'Home',
      command: `${command}\n`,
      action: 'home',
      source: 'motion',
      timeoutMs: homeLineTimeoutMs(get(), driver),
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
  await verifyHomedAxes(refs, safeWrite, driver);
  assertHomeCurrent(get(), refs, epochs);
  set({ controllerOperation: homeOperation(epochs.operationId, 'awaiting-idle') });
  await waitForFreshIdle(refs, { kind: 'home', requiredReports: 1 });
  assertHomeCurrent(get(), refs, epochs);
  confirmHome(set, get, epochs);
}

// Home establishes machine position, not the absence of G92/G54 offsets: a
// prior origin stays unresolved until a fresh accepted WCO proves it. Marlin is
// the exception: homing clears its G92 shift (motion.cpp:2346-2349), which
// KerfDesk records itself (host-recorded-origin.ts; audit MA-2).
function homeOriginPatch(state: LaserState): Partial<LaserState> {
  if (state.capabilities.workOffsetSource === 'host-recorded') {
    return { wcoCache: NO_WORK_OFFSET, workOriginActive: false, workOriginSource: 'none' };
  }
  const keepsOrigin = state.workOriginActive || state.workOriginSource !== 'none';
  return {
    wcoCache: null,
    workOriginActive: keepsOrigin,
    workOriginSource: keepsOrigin ? 'unknown' : 'none',
  };
}

/** The firmware answered its Home line although it homed nothing (SM-6). */
class HomeNotConfirmedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HomeNotConfirmedError';
  }
}

// Firmware whose Home answers `ok` whether or not anything homed is asked which
// axes it homed before the Home is confirmed (Smoothieware G28.6; controller
// audit 2026-09-25 SM-6).
async function verifyHomedAxes(
  refs: ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
  driver: ControllerDriver,
): Promise<void> {
  const verification = driver.homeVerification;
  if (verification === undefined) return;
  const responses = await startControllerCommand(refs, safeWrite, {
    kind: 'home',
    label: 'homed axes query',
    command: `${verification.query}\n`,
    action: 'home',
    source: 'system',
  });
  const reason = verification.unhomedReason(responses);
  if (reason !== null) throw new HomeNotConfirmedError(reason);
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
    activeWcs: null,
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
      safetyNotice: state.safetyNotice ?? homeFailureNotice(error, message),
      log: pushLog(state, `[lf2] Home failed: ${message}`),
    };
  });
}

// Only a line the controller answered with error:N was rejected; a timeout, an
// alarm or a voided attempt is a Home that did not finish (audit ST-4).
function homeFailureNotice(error: unknown, message: string): LaserSafetyNotice {
  if (error instanceof HomeNotConfirmedError) return homeNotConfirmedNotice(message);
  if (!(error instanceof ControllerCommandRefusedError)) return homeUnfinishedNotice(message);
  const code = /^error:(\d+)$/i.exec(message.trim());
  return code === null
    ? controllerErrorNotice(null, 'command', message)
    : controllerErrorNotice(Number(code[1]), 'command');
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
