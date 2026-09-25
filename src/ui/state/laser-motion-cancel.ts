import {
  cancelFreshControllerStatusWait,
  waitForFreshControllerStatus,
} from './laser-controller-status-wait';
import { startControllerCommand } from './laser-interactive-command';
import type { LaserMotionOperation, LaserMotionOperationId } from './laser-motion-operation';
import type { LaserState, LiveRefs } from './laser-store';
import type { GetFn, SafeWriteFn, SetFn } from './laser-line-shared';
import {
  assertCancelContext,
  createCancelContext,
  publishCancelFailure,
  type CancelContext,
  type MotionCancelRefs,
} from './laser-motion-cancel-context';
import { pendingTransportWriteCount } from './laser-start-queue-fence';
import { cancelPendingManualMotions } from './manual-motion-intent';

const CANCEL_QUEUE_TIMEOUT_MS = 8_000;
const CANCEL_QUEUE_POLL_MS = 10;
const CONTROLLER_STATE_TIMEOUT_MESSAGE = 'Timed out waiting for controller state after Cancel.';
// Disconnect and Reconnect are disabled while a motion owner exists, so the
// guidance names what the operator can actually do: KerfDesk settles and
// releases the owner itself on the controller's next Idle report.
const MOTION_STOP_TIMEOUT_MESSAGE =
  'Timed out waiting for motion to stop after Cancel. KerfDesk releases motion control when the controller next reports Idle; use ABORT MOTION to stop the machine now.';
const AUTOMATIC_RELEASE_FAILURE_HEADING = 'Releasing the stopped motion needs attention';

export async function runCancelJog(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  // A jog/Frame still proving fresh Idle has no motion owner yet. Its cancel
  // must poison it now, or it writes its (possibly boundary-length) move after
  // this 0x85 already reached an Idle controller that ignored it.
  cancelPendingManualMotions(refs);
  const context = createCancelContext(set, get, refs, safeWrite);
  const operationId = context.operationId;
  // Cancel intent itself expires a completed Frame permit, even when no live
  // motion owner exists (for example a key/button release after a zero-length
  // jog). Authorization never survives a realtime cancel attempt.
  set((state) => ({
    manualMotionCancelEpoch: state.manualMotionCancelEpoch + 1,
    frameVerification: null,
    framedRun: null,
    frameTrace: null,
  }));
  if (operationId !== undefined) markMotionOperationCancelling(context, operationId);
  try {
    const cancelError = await writeJogCancel(context);
    try {
      await settleCancelledMotion(context, operationId);
    } catch (settlementError) {
      throw cancelError ?? settlementError;
    }
    if (cancelError !== undefined) throw cancelError;
  } catch (error) {
    publishCancelFailure(context, error);
    throw error;
  }
}

/** Settles and releases a motion owner that was cancelled without an operator
 * Cancel: the controller rejected one of its lines (error:N), its write failed,
 * or an earlier Cancel attempt gave up. The caller starts it only on a fresh
 * Idle with the owner's acknowledgements drained, so no realtime jog-cancel is
 * sent; the release uses the same causal proof as Cancel — ack-owned settle
 * marker, then a stamped status query, then a later Idle. */
export async function settleAbandonedMotionOperation(
  set: SetFn,
  get: GetFn,
  refs: MotionCancelRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  const context = createCancelContext(set, get, refs, safeWrite, AUTOMATIC_RELEASE_FAILURE_HEADING);
  const operationId = context.operationId;
  if (operationId === undefined) return;
  markMotionOperationCancelling(context, operationId, true);
  try {
    await settleCancelledMotion(context, operationId);
  } catch (error) {
    publishCancelFailure(context, error);
  }
}

async function settleCancelledMotion(
  context: CancelContext,
  operationId: LaserMotionOperationId | undefined,
): Promise<void> {
  await waitForCancelledMotionQueue(context, operationId);
  await armCancelledMotionStatusFence(context, operationId);
}

function markMotionOperationCancelling(
  context: CancelContext,
  operationId: LaserMotionOperationId,
  automaticRelease = false,
): void {
  context.set((state) =>
    state.motionOperation?.operationId === operationId
      ? {
          motionOperation: cancellingMotionOperation(
            state.motionOperation,
            context.attemptId,
            automaticRelease,
          ),
        }
      : {},
  );
  // A phase barrier may currently own the singleton fresh-status waiter.
  // Cancel supersedes that proof and must release it before arming the
  // cancellation marker/status fence of its own.
  cancelFreshControllerStatusWait(context.refs, 'Motion settlement was superseded by Cancel.');
}

async function writeJogCancel(context: CancelContext): Promise<unknown | undefined> {
  assertCancelContext(context);
  const jogCancel = context.refs.driver.realtime.jogCancel;
  if (jogCancel === null) return undefined;
  try {
    await context.safeWrite(jogCancel, 'jog');
    return undefined;
  } catch (error) {
    return error;
  }
}

function cancellingMotionOperation(
  operation: LaserMotionOperation,
  attemptId: symbol,
  automaticRelease: boolean,
): LaserMotionOperation {
  const { cancelStatusQueryAfterSequence: staleFence, ...unstamped } = operation;
  void staleFence;
  return {
    ...unstamped,
    cancelRequested: true,
    cancelAttemptId: attemptId,
    ...(automaticRelease
      ? { automaticReleaseAttempts: (operation.automaticReleaseAttempts ?? 0) + 1 }
      : {}),
  };
}

async function waitForCancelledMotionQueue(
  context: CancelContext,
  operationId: LaserMotionOperationId | undefined,
): Promise<void> {
  if (operationId === undefined) return;
  const deadline = Date.now() + CANCEL_QUEUE_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    assertCancelContext(context);
    const state = context.get();
    if (motionQueueSettled(state)) return;
    await sleep(CANCEL_QUEUE_POLL_MS);
  }
  throw new Error(
    'Cancel is waiting for the previous motion command acknowledgement. Reconnect if the controller does not respond.',
  );
}

function motionQueueSettled(state: LaserState): boolean {
  return (
    state.pendingUntrackedAcks === 0 &&
    pendingTransportWriteCount(state) === 0 &&
    (state.motionOperation?.pendingMotionTransportWrites ?? 0) === 0
  );
}

async function armCancelledMotionStatusFence(
  context: CancelContext,
  operationId: LaserMotionOperationId | undefined,
): Promise<void> {
  if (operationId === undefined) return;
  assertCancelContext(context);
  await waitForCancelledMotionIdleBeforeMarker(context, operationId);
  // A queued status query (Marlin M114) owes its own trailing `ok`, which
  // arrives after its report. The marker's command owner would claim that ok
  // as its own terminal acknowledgement, so the query must drain first.
  await waitForCancelledMotionQueue(context, operationId);
  assertCancelContext(context);
  await crossCancellationSettlementMarker(context);
  assertCancelContext(context);
  const statusQuery = cancellationStatusQuery(context.refs);
  if (statusQuery === null) {
    throw new Error(
      'Cancel cannot confirm a fresh controller Idle on this driver. Reconnect before sending more motion.',
    );
  }
  await confirmCancelledMotionIdle(context, operationId, statusQuery);
}

async function waitForCancelledMotionIdleBeforeMarker(
  context: CancelContext,
  operationId: LaserMotionOperationId,
): Promise<void> {
  const statusQuery = cancellationStatusQuery(context.refs);
  if (statusQuery === null) {
    throw new Error(
      'Cancel cannot confirm that motion stopped on this driver. Reconnect before sending more motion.',
    );
  }
  const deadline = Date.now() + CANCEL_QUEUE_TIMEOUT_MS;
  let controllerAnswered = false;
  while (context.get().motionOperation?.operationId === operationId) {
    await waitForCancelledMotionQueue(context, operationId);
    // Near the deadline the query budget shrinks to a millisecond. Once the
    // controller has answered, that expiry means motion did not stop in time,
    // not that the controller went silent.
    const report = await queryCancellationStatus(
      context,
      statusQuery,
      deadline,
      controllerAnswered ? MOTION_STOP_TIMEOUT_MESSAGE : CONTROLLER_STATE_TIMEOUT_MESSAGE,
    );
    controllerAnswered = true;
    assertCancelContext(context);
    if (report.state === 'Idle') return;
    if (report.state === 'Jog') {
      // GRBL ignores 0x85 unless it has already entered STATE_JOG. A first
      // cancel written during the command -> Jog transition is therefore not
      // proof. Re-send only after a fresh Jog report, then query again.
      const retryError = await writeJogCancel(context);
      if (retryError !== undefined) throw retryError;
    }
    if (Date.now() >= deadline) break;
    await sleep(CANCEL_QUEUE_POLL_MS);
  }
  throw new Error(MOTION_STOP_TIMEOUT_MESSAGE);
}

async function queryCancellationStatus(
  context: CancelContext,
  statusQuery: string,
  deadline: number,
  timeoutMessage: string,
): Promise<Awaited<ReturnType<typeof waitForFreshControllerStatus>>> {
  assertCancelContext(context);
  const beforeQuery = context.get();
  const alreadyWaiting = context.refs.controllerStatusWait != null;
  const confirmation = waitForFreshControllerStatus(context.refs, {
    after: {
      sessionEpoch: beforeQuery.controllerSessionEpoch,
      sequence: beforeQuery.statusSequence,
    },
    accept: () => true,
    timeoutMs: Math.max(1, deadline - Date.now()),
    timeoutMessage,
  });
  const ownedWait = alreadyWaiting ? null : context.refs.controllerStatusWait;
  try {
    const [, report] = await Promise.all([
      context.safeWrite(statusQuery, undefined, 'poll'),
      confirmation,
    ]);
    return report;
  } catch (error) {
    if (ownedWait != null && context.refs.controllerStatusWait === ownedWait) {
      cancelFreshControllerStatusWait(
        context.refs,
        'Motion-cancel status observation was cancelled.',
      );
    }
    throw error;
  }
}

async function crossCancellationSettlementMarker(context: CancelContext): Promise<void> {
  assertCancelContext(context);
  // A status report has no query identifier, so a delayed response to an old
  // background query cannot itself prove cancellation. The ack-owned marker
  // makes every later status observation causal to the cancelled motion queue.
  await startControllerCommand(context.refs, context.safeWrite, {
    kind: 'interactive-command',
    label: 'motion-cancel settle marker',
    command: `${context.refs.driver.commands.settleDwell}\n`,
    action: 'jog',
    source: 'motion',
    timeoutMode: 'non-idle-status-activity',
  });
}

function cancellationStatusQuery(refs: MotionCancelRefs): string | null {
  return (
    refs.driver.realtime.statusQuery ??
    (refs.driver.commands.queuedStatusQuery === null
      ? null
      : `${refs.driver.commands.queuedStatusQuery}\n`)
  );
}

async function confirmCancelledMotionIdle(
  context: CancelContext,
  operationId: LaserMotionOperationId,
  statusQuery: string,
): Promise<void> {
  assertCancelContext(context);
  const beforeQuery = context.get();
  context.set((state) =>
    state.motionOperation?.operationId === operationId
      ? {
          motionOperation: {
            ...state.motionOperation,
            cancelStatusQueryAfterSequence: state.statusSequence,
          },
        }
      : {},
  );
  const alreadyWaiting = context.refs.controllerStatusWait != null;
  const confirmation = waitForFreshControllerStatus(context.refs, {
    after: {
      sessionEpoch: beforeQuery.controllerSessionEpoch,
      sequence: beforeQuery.statusSequence,
    },
    accept: (report) => report.state === 'Idle' || report.mpgActive === true,
    timeoutMessage: 'Timed out waiting for a post-cancel Idle status report.',
  });
  const ownedWait = alreadyWaiting ? null : context.refs.controllerStatusWait;
  try {
    await Promise.all([context.safeWrite(statusQuery, undefined, 'poll'), confirmation]);
    assertCancelContext(context, true);
  } catch (error) {
    if (ownedWait != null && context.refs.controllerStatusWait === ownedWait) {
      cancelFreshControllerStatusWait(
        context.refs,
        'Motion-cancel status confirmation was cancelled.',
      );
    }
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
