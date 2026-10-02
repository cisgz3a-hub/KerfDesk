import type { MotionPoint } from '../../core/job/motion-manifest';
import type {
  PreparedStartProgram,
  FramedRunControllerSnapshot,
  FramedRunPermit,
} from './framed-run';
import {
  controllerOperationOwner,
  interactiveControllerOperation,
  type LaserControllerOperation,
} from './laser-controller-operation';
import type { LaserState } from './laser-store';

export type JobStartMarkRequest = {
  readonly prepared: PreparedStartProgram;
  readonly controller: FramedRunControllerSnapshot;
  readonly connectionAttempt: LaserState['connectionAttempt'];
  readonly initialPosition: MotionPoint;
  readonly frame: FramedRunPermit | null;
  readonly preparationOperation?: LaserControllerOperation;
};

export type JobStartMarkPhase =
  | 'preflight'
  | 'travel'
  | 'pulse'
  | 'return'
  | 'settling'
  | 'uncertain';
type MarkOperation = Extract<LaserControllerOperation, { readonly kind: 'job-start-mark' }>;
type MarkOwner = {
  readonly sessionEpoch: number;
  readonly connectionAttempt: LaserState['connectionAttempt'];
  readonly cancelEpoch: number;
  readonly frame: FramedRunPermit | null;
};

const owners = new WeakMap<object, MarkOwner>();
const preparations = new WeakSet<LaserControllerOperation>();

export function createJobStartMarkPreparationOperation(): LaserControllerOperation {
  const operation = interactiveControllerOperation(
    'Preparing the timed job-start mark',
    'terminal-exchange',
  );
  preparations.add(operation);
  return operation;
}

export function jobStartMarkPreparationIsOwned(
  state: LaserState,
  request: JobStartMarkRequest,
): boolean {
  const operation = request.preparationOperation;
  return (
    operation !== undefined &&
    preparations.has(operation) &&
    state.controllerOperation === operation
  );
}

/** Register only a new admitted transaction. Phase continuations retain this
 * private identity; a generic operation or jog never obtains its exception. */
export function createJobStartMarkOperation(
  state: LaserState,
  frame: FramedRunPermit | null,
): MarkOperation {
  const operation: MarkOperation = { kind: 'job-start-mark', phase: 'preflight' };
  owners.set(operation, {
    sessionEpoch: state.controllerSessionEpoch,
    connectionAttempt: state.connectionAttempt,
    cancelEpoch: state.manualMotionCancelEpoch,
    frame,
  });
  return operation;
}

export function jobStartMarkIsOwned(state: LaserState): boolean {
  const operation = state.controllerOperation;
  if (operation?.kind !== 'job-start-mark' || operation.phase === 'uncertain') return false;
  const owner = owners.get(controllerOperationOwner(operation));
  return (
    owner !== undefined &&
    state.connection.kind === 'connected' &&
    state.controllerSessionEpoch === owner.sessionEpoch &&
    state.connectionAttempt === owner.connectionAttempt &&
    state.manualMotionCancelEpoch === owner.cancelEpoch
  );
}

export function jobStartMarkOwnsFrame(state: LaserState, frame: FramedRunPermit): boolean {
  const operation = state.controllerOperation;
  if (operation === null || !jobStartMarkIsOwned(state)) return false;
  return (
    owners.get(controllerOperationOwner(operation))?.frame === frame &&
    state.completedFrame === frame &&
    state.frameVerification === frame.candidate.frameVerification
  );
}

export function jobStartMarkAcceptsStatus(
  state: LaserState,
  report: LaserState['statusReport'],
): boolean {
  return (
    jobStartMarkIsOwned(state) &&
    report !== null &&
    report.mpgActive !== true &&
    (report.state === 'Idle' || report.state === 'Run')
  );
}
