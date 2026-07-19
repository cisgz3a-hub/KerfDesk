import {
  cancelFreshControllerStatusWait,
  waitForFreshControllerStatus,
} from './laser-controller-status-wait';
import { startControllerCommand } from './laser-interactive-command';
import type { LaserMotionOperation, LaserMotionOperationId } from './laser-motion-operation';
import type { LaserState, LiveRefs } from './laser-store';
import type { GetFn, SafeWriteFn, SetFn } from './laser-line-shared';

const CANCEL_QUEUE_TIMEOUT_MS = 8_000;
const CANCEL_QUEUE_POLL_MS = 10;

type CancelContext = {
  readonly set: SetFn;
  readonly get: GetFn;
  readonly refs: LiveRefs;
  readonly safeWrite: SafeWriteFn;
};

export async function runCancelJog(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  const context = { set, get, refs, safeWrite };
  const operationId = get().motionOperation?.operationId;
  // Cancel intent itself expires a completed Frame permit, even when no live
  // motion owner exists (for example a key/button release after a zero-length
  // jog). Authorization never survives a realtime cancel attempt.
  set({ frameVerification: null, framedRun: null });
  if (operationId !== undefined) markMotionOperationCancelling(context, operationId);
  const cancelError = await writeJogCancel(refs, safeWrite);
  try {
    await waitForCancelledMotionQueue(get, operationId);
    await armCancelledMotionStatusFence(context, operationId);
  } catch (settlementError) {
    throw cancelError ?? settlementError;
  }
  if (cancelError !== undefined) throw cancelError;
}

function markMotionOperationCancelling(
  context: CancelContext,
  operationId: LaserMotionOperationId,
): void {
  context.set((state) =>
    state.motionOperation?.operationId === operationId
      ? { motionOperation: cancellingMotionOperation(state.motionOperation) }
      : {},
  );
  // A phase barrier may currently own the singleton fresh-status waiter.
  // Cancel supersedes that proof and must release it before arming the
  // cancellation marker/status fence of its own.
  cancelFreshControllerStatusWait(context.refs, 'Motion settlement was superseded by Cancel.');
}

async function writeJogCancel(
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Promise<unknown | undefined> {
  const jogCancel = refs.driver.realtime.jogCancel;
  if (jogCancel === null) return undefined;
  try {
    await safeWrite(jogCancel, 'jog');
    return undefined;
  } catch (error) {
    return error;
  }
}

function cancellingMotionOperation(operation: LaserMotionOperation): LaserMotionOperation {
  const { cancelStatusQueryAfterSequence: staleFence, ...unstamped } = operation;
  void staleFence;
  return { ...unstamped, cancelRequested: true };
}

async function waitForCancelledMotionQueue(
  get: GetFn,
  operationId: LaserMotionOperationId | undefined,
): Promise<void> {
  if (operationId === undefined) return;
  const deadline = Date.now() + CANCEL_QUEUE_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const state = get();
    if (state.motionOperation?.operationId !== operationId) return;
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
    (state.pendingTransportWrites ?? 0) === 0 &&
    (state.motionOperation?.pendingMotionTransportWrites ?? 0) === 0
  );
}

async function armCancelledMotionStatusFence(
  context: CancelContext,
  operationId: LaserMotionOperationId | undefined,
): Promise<void> {
  if (operationId === undefined || context.get().motionOperation?.operationId !== operationId) {
    return;
  }
  await crossCancellationSettlementMarker(context);
  if (context.get().motionOperation?.operationId !== operationId) return;
  const statusQuery = cancellationStatusQuery(context.refs);
  if (statusQuery === null) {
    throw new Error(
      'Cancel cannot confirm a fresh controller Idle on this driver. Reconnect before sending more motion.',
    );
  }
  await confirmCancelledMotionIdle(context, operationId, statusQuery);
}

async function crossCancellationSettlementMarker(context: CancelContext): Promise<void> {
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

function cancellationStatusQuery(refs: LiveRefs): string | null {
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
  const confirmation = waitForFreshControllerStatus(context.refs, {
    after: {
      sessionEpoch: beforeQuery.controllerSessionEpoch,
      sequence: beforeQuery.statusSequence,
    },
    accept: (report) => report.state === 'Idle',
    timeoutMessage: 'Timed out waiting for a post-cancel Idle status report.',
  });
  try {
    await Promise.all([context.safeWrite(statusQuery, undefined, 'poll'), confirmation]);
  } catch (error) {
    cancelFreshControllerStatusWait(
      context.refs,
      'Motion-cancel status confirmation was cancelled.',
    );
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
