import type { ControllerDriver } from '../../core/controllers';
import { buildJobStartMarkPlan, jobStartMarkPulseBatch } from '../../core/job/job-start-mark';
import { rotaryAppliesTo } from '../../core/job';
import { DEFAULT_FIRE_POWER_PERCENT } from '../../core/devices/fire-control';
import { controllerStartPreparationStillCurrent } from '../laser/start-job-authorization';
import { currentReplayExecutionSignature } from '../laser/start-job-execution-tracking';
import { framedRunReadinessIssue } from '../laser/framed-run-readiness';
import { invalidateAccessoryObservation } from './cnc-accessory-readiness';
import { fireActivationBlockMessage } from './laser-fire-actions';
import { currentFirePowerS } from './laser-fire-power';
import {
  createJobStartMarkOperation,
  jobStartMarkPreparationIsOwned,
  type JobStartMarkRequest,
} from './job-start-mark';
import {
  assertJobStartMarkCurrent,
  assertMarkHeadAt,
  assertMarkReturned,
  markCommand,
  markFreshIdle,
  setJobStartMarkPhase,
  type MarkTransaction,
} from './laser-job-start-mark-transaction';
import {
  controllerOperationOwner,
  continueControllerOperation,
} from './laser-controller-operation';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import type { SerialConnection } from '../../platform/types';
import type { SafeWrite } from './laser-safe-write';
import { frameProofReset } from './laser-session-reset';
import { pendingTransportWriteCount } from './laser-start-queue-fence';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';
import { LASER_START_OVERRIDE_RESET } from './laser-start-override-reset';
import { settleJobStartMarkMotion } from './laser-job-start-mark-settlement';
import { useStore } from './store';
import { reportedWorkPositionMm } from './canvas-motion-plan';

type SetFn = (patch: Partial<LaserState>) => void;
type MarkRefs = ControllerLifecycleRefs & {
  readonly driver: ControllerDriver;
  readonly connection: SerialConnection | null;
};

export function jobStartMarkBlockMessage(state: LaserState): string | null {
  const fireBlock = fireActivationBlockMessage(state);
  if (fireBlock !== null) return fireBlock;
  if (state.fireActive) return 'Release Fire before marking the job start.';
  if (pendingTransportWriteCount(state) > 0)
    return 'Wait for the previous controller write to settle.';
  const project = useStore.getState().project;
  if (rotaryAppliesTo(project.device, project.machine))
    return 'A start mark needs a Cartesian laser placement; rotary marks are not qualified.';
  return ['grbl-v1.1', 'grblhal', 'fluidnc'].includes(state.activeControllerKind)
    ? null
    : 'Timed start marks are available on GRBL-family laser controllers.';
}

export function jobStartMarkActions(
  set: SetFn,
  get: () => LaserState,
  refs: MarkRefs,
  write: SafeWrite,
): Pick<LaserState, 'markJobStart'> {
  return { markJobStart: (request) => runJobStartMark(set, get, refs, write, request) };
}

async function runJobStartMark(
  set: SetFn,
  get: () => LaserState,
  refs: MarkRefs,
  write: SafeWrite,
  request: JobStartMarkRequest,
): Promise<void> {
  assertMarkAdmission(get(), request);
  const device = useStore.getState().project.device;
  const control = device.fireControl;
  if (control === undefined) throw new Error('Enable low-power Fire in Device Profile first.');
  const powerS = currentFirePowerS(get(), control, device.maxPowerS, DEFAULT_FIRE_POWER_PERCENT);
  const plan = buildJobStartMarkPlan(
    request.prepared.gcode,
    request.initialPosition,
    powerS,
    device.framingFeedMmPerMin,
  );
  const state = get();
  const operation = createJobStartMarkOperation(state, request.frame);
  const connection = refs.connection;
  const writeEpoch = refs.writeEpoch;
  const cancelEpoch = state.manualMotionCancelEpoch;
  const ownsSession = (): boolean =>
    get().connection.kind === 'connected' &&
    get().controllerSessionEpoch === request.controller.controllerSessionEpoch &&
    get().connectionAttempt === request.connectionAttempt &&
    refs.connection === connection &&
    refs.writeEpoch === writeEpoch &&
    get().manualMotionCancelEpoch === cancelEpoch;
  const context: MarkTransaction = {
    set,
    get,
    refs,
    write,
    driver: refs.driver,
    request,
    plan,
    owner: operation,
    ownsSession,
  };
  set({ controllerOperation: operation, lastWriteError: null });
  try {
    const dispatchedPowerS = await dispatchMark(context, powerS);
    assertMarkReturned(context);
    set({
      controllerOperation: null,
      fireActive: false,
      lastWriteError: null,
      log: pushLog(
        get(),
        `[lf2] Marked the first emitted burn point at X${plan.point.x} Y${plan.point.y}, S${dispatchedPowerS}, for 1 second; returned to the original head position.`,
      ),
    });
  } catch (error) {
    await containMarkFailure(context, error);
    throw error;
  }
}

function assertMarkAdmission(state: LaserState, request: JobStartMarkRequest): void {
  if (
    request.preparationOperation !== undefined &&
    !jobStartMarkPreparationIsOwned(state, request)
  ) {
    throw new Error('The timed start-mark preparation was cancelled or replaced.');
  }
  const blocked = jobStartMarkBlockMessage(
    jobStartMarkPreparationIsOwned(state, request)
      ? { ...state, controllerOperation: null }
      : state,
  );
  if (blocked !== null) throw new Error(blocked);
  if (state.activeWcs !== 'G54')
    throw new Error('The start mark needs the prepared job’s active G54 coordinates.');
  assertMarkControllerBasis(state, request);
  if (
    request.frame !== null &&
    (state.completedFrame !== request.frame ||
      framedRunReadinessIssue(request.frame, undefined, state) !== null)
  ) {
    throw new Error('The completed Frame changed before the start mark.');
  }
}

function assertMarkControllerBasis(state: LaserState, request: JobStartMarkRequest): void {
  const initial = reportedWorkPositionMm(state, state.controllerSettings?.reportInches === true);
  if (
    initial === null ||
    (['x', 'y', 'z'] as const).some((axis) => initial[axis] !== request.initialPosition[axis])
  ) {
    throw new Error(
      'The start mark’s captured head position does not match the current controller.',
    );
  }
  if (
    request.connectionAttempt !== state.connectionAttempt ||
    !controllerStartPreparationStillCurrent(request.controller, state, {
      ignoreAdvisoryControllerEvidence: true,
    }) ||
    currentReplayExecutionSignature() !== request.prepared.canvasPlan.retentionKey
  ) {
    throw new Error(
      'The job or controller changed before the start mark. Prepare the current job again.',
    );
  }
}

async function dispatchMark(context: MarkTransaction, powerS: number): Promise<number> {
  // Off/ACK and a planner fence drain replies to older polls before the new
  // query. A genuine query reply may arrive before its write promise settles.
  await markCommand(context, 'Start mark laser off', 'M5\n');
  await settleJobStartMarkMotion(context, 'Start mark preflight settlement');
  await markFreshIdle(context);
  assertMarkReturned(context);
  await resetMarkOverrides(context);
  setJobStartMarkPhase(context, 'travel');
  await markCommand(context, 'Start mark beam-off travel', context.plan.travelLine);
  await settleJobStartMarkMotion(context, 'Start mark travel settlement');
  await markFreshIdle(context);
  assertMarkHeadAt(context, context.plan.point);
  const device = useStore.getState().project.device;
  const control = device.fireControl;
  if (control === undefined) throw new Error('The low-power Fire profile changed during the mark.');
  const dispatchedPowerS = Math.min(
    powerS,
    currentFirePowerS(context.get(), control, device.maxPowerS, DEFAULT_FIRE_POWER_PERCENT),
  );
  const pulseBatch = jobStartMarkPulseBatch(dispatchedPowerS, device.framingFeedMmPerMin);
  setJobStartMarkPhase(context, 'pulse');
  context.set({
    fireActive: true,
    accessoryCache: invalidateAccessoryObservation(context.get().accessoryCache),
  });
  // The complete small batch is queued in ONE transport write. M5 is already
  // behind firmware's G4 before any host timer/ACK continuation can run.
  await markCommand(context, `One-second start mark S${dispatchedPowerS}`, pulseBatch, 3);
  context.set({ fireActive: false });
  setJobStartMarkPhase(context, 'return');
  await markCommand(context, 'Start mark beam-off return', context.plan.returnLine);
  await settleJobStartMarkMotion(context, 'Start mark return settlement');
  setJobStartMarkPhase(context, 'settling');
  await markFreshIdle(context);
  return dispatchedPowerS;
}

async function resetMarkOverrides(context: MarkTransaction): Promise<void> {
  if (!context.get().capabilities.overrides) return;
  // The preflight drain ACK has flushed older realtime override flags. No
  // adjustment is admitted while this operation owns the controller.
  assertJobStartMarkCurrent(context);
  await context.write(LASER_START_OVERRIDE_RESET, 'fire', 'system');
  assertJobStartMarkCurrent(context);
}

async function containMarkFailure(context: MarkTransaction, error: unknown): Promise<void> {
  const operation = context.get().controllerOperation;
  if (
    !context.ownsSession() ||
    operation === null ||
    controllerOperationOwner(operation) !== context.owner
  )
    return;
  const message = error instanceof Error ? error.message : String(error);
  context.set({
    ...frameProofReset(),
    lastWriteError: message,
    controllerOperation: continueControllerOperation(operation, {
      kind: 'job-start-mark',
      phase: 'uncertain',
    }),
    log: pushLog(
      context.get(),
      `[lf2] Start mark failed: ${message}. Requesting Abort; position and shutoff need confirmation.`,
    ),
  });
  // Use the existing connection-bound Abort lifecycle; its reset/cleanup owns
  // the original transport and cannot send M5 or Ctrl-X to a replacement port.
  await context
    .get()
    .stopJob()
    .catch(() => undefined);
}
