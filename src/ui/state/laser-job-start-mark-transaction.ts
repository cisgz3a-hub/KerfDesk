import type { ControllerDriver } from '../../core/controllers';
import type { JobStartMarkPlan } from '../../core/job/job-start-mark';
import type { MotionPoint } from '../../core/job/motion-manifest';
import { controllerStartPreparationStillCurrent } from '../laser/start-job-authorization';
import { currentReplayExecutionSignature } from '../laser/start-job-execution-tracking';
import { reportedWorkPositionMm } from './canvas-motion-plan';
import { fireActivationBlockMessage } from './laser-fire-actions';
import {
  cancelFreshControllerStatusWait,
  waitForFreshControllerStatus,
} from './laser-controller-status-wait';
import {
  controllerOperationOwner,
  continueControllerOperation,
} from './laser-controller-operation';
import { startControllerCommand, type ControllerLifecycleRefs } from './laser-interactive-command';
import type { SafeWrite } from './laser-safe-write';
import type { LaserState } from './laser-store';
import type { JobStartMarkPhase, JobStartMarkRequest } from './job-start-mark';

export type MarkTransaction = {
  readonly set: (patch: Partial<LaserState>) => void;
  readonly get: () => LaserState;
  readonly refs: ControllerLifecycleRefs;
  readonly write: SafeWrite;
  readonly driver: ControllerDriver;
  readonly request: JobStartMarkRequest;
  readonly plan: JobStartMarkPlan;
  readonly owner: object;
  readonly ownsSession: () => boolean;
};

export function assertJobStartMarkCurrent(context: MarkTransaction): void {
  assertMarkOperationOwner(context);
  const current = context.get();
  if (currentReplayExecutionSignature() !== context.request.prepared.canvasPlan.retentionKey) {
    throw new Error('The job changed while the start mark was being prepared or executed.');
  }
  if (!markOriginIsCurrent(context))
    throw new Error('The work origin or coordinate basis changed during the start mark.');
  if (current.statusReport?.state !== 'Idle' && current.statusReport?.state !== 'Run') {
    throw new Error('The controller interrupted the start mark. Abort and confirm its position.');
  }
  const idleView = {
    ...current,
    controllerOperation: null,
    fireActive: false,
    statusReport:
      current.statusReport === null ? null : { ...current.statusReport, state: 'Idle' as const },
  };
  const blocked = fireActivationBlockMessage(idleView, true);
  if (blocked !== null || current.mpgActive === true) {
    throw new Error(blocked ?? 'The pendant took control during the start mark.');
  }
}

function assertMarkOperationOwner(context: MarkTransaction): void {
  const operation = context.get().controllerOperation;
  if (
    !context.ownsSession() ||
    operation?.kind !== 'job-start-mark' ||
    operation.phase === 'uncertain' ||
    controllerOperationOwner(operation) !== context.owner
  ) {
    throw new Error('The start mark was cancelled or its controller session changed.');
  }
}

function markOriginIsCurrent(context: MarkTransaction): boolean {
  const current = context.get();
  return (
    current.activeWcs === 'G54' &&
    controllerStartPreparationStillCurrent(
      { ...context.request.controller, statusReport: current.statusReport },
      current,
      { ignoreStatusState: true, ignoreAdvisoryControllerEvidence: true },
    )
  );
}

export function setJobStartMarkPhase(context: MarkTransaction, phase: JobStartMarkPhase): void {
  assertJobStartMarkCurrent(context);
  context.set({
    controllerOperation: continueControllerOperation(context.get().controllerOperation, {
      kind: 'job-start-mark',
      phase,
    }),
  });
}

export async function markCommand(
  context: MarkTransaction,
  label: string,
  command: string,
  terminalAckCount = 1,
): Promise<void> {
  assertJobStartMarkCurrent(context);
  await startControllerCommand(context.refs, context.write, {
    kind: 'job-start-mark',
    label,
    command,
    terminalAckCount,
    action: 'fire',
    source: 'motion',
    timeoutMs: 3_000,
  });
  assertJobStartMarkCurrent(context);
}

/** Polling is reserved and an owned command/ACK drains earlier reports before
 * each query. Register first so a genuine synchronous/early answer survives;
 * both the query's transport handoff and its fresh report must settle. */
export async function markFreshIdle(context: MarkTransaction): Promise<void> {
  assertJobStartMarkCurrent(context);
  const query = context.driver.realtime.statusQuery;
  if (query === null) throw new Error('The start mark needs a realtime controller status query.');
  const current = context.get();
  const result = waitForFreshControllerStatus(context.refs, {
    after: { sessionEpoch: current.controllerSessionEpoch, sequence: current.statusSequence },
    accept: () => true,
    timeoutMs: 3_000,
    timeoutMessage: 'The start mark could not confirm a fresh same-session Idle position.',
  });
  const ownedWait = context.refs.controllerStatusWait;
  const handoff = watchMarkQueryHandoff(context);
  try {
    const [, report] = await Promise.race([
      Promise.all([context.write(query, 'fire', 'system'), result]),
      handoff.failure,
    ]);
    assertJobStartMarkCurrent(context);
    if (report.state !== 'Idle')
      throw new Error(`The start mark expected fresh Idle, received ${report.state}.`);
  } finally {
    handoff.cancel();
    if (context.refs.controllerStatusWait === ownedWait)
      cancelFreshControllerStatusWait(context.refs);
  }
}

/** A replied query may still have an unresolved transport promise. Its
 * completion and cancellation remain owned even after the report waiter ends. */
function watchMarkQueryHandoff(context: MarkTransaction): {
  readonly failure: Promise<never>;
  readonly cancel: () => void;
} {
  let deadline: ReturnType<typeof setTimeout>;
  let ownership: ReturnType<typeof setInterval>;
  const failure = new Promise<never>((_resolve, reject) => {
    deadline = setTimeout(
      () => reject(new Error('The start-mark query handoff timed out.')),
      3_000,
    );
    ownership = setInterval(() => {
      try {
        assertJobStartMarkCurrent(context);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, 100);
  });
  return {
    failure,
    cancel: () => {
      clearTimeout(deadline);
      clearInterval(ownership);
    },
  };
}

export function assertMarkHeadAt(context: MarkTransaction, expected: MotionPoint): void {
  const state = context.get();
  const inches = state.controllerSettings?.reportInches === true;
  const actual = reportedWorkPositionMm(state, inches);
  // Target coordinates are final emitted mm, whereas GRBL reports at 0.001mm
  // or 0.0001 inch. Permit retention below separately compares the original
  // observed XYZ strictly, including representation conversion where needed.
  const tick = inches ? 0.00254 : 0.001;
  if (
    actual === null ||
    (['x', 'y', 'z'] as const).some(
      (axis) =>
        Math.abs(actual[axis] - expected[axis]) >
        tick + Number.EPSILON * Math.max(1, Math.abs(expected[axis])) * 4,
    )
  ) {
    throw new Error('The start mark did not reach its planned work position.');
  }
}

export function assertMarkReturned(context: MarkTransaction): void {
  assertJobStartMarkCurrent(context);
  if (
    !controllerStartPreparationStillCurrent(context.request.controller, context.get(), {
      ignoreAdvisoryControllerEvidence: true,
    })
  ) {
    throw new Error(
      'The start mark did not return to the original observed XYZ position. Frame again.',
    );
  }
}
