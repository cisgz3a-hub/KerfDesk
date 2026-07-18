import {
  cancelFreshControllerStatusWait,
  waitForFreshControllerStatus,
} from './laser-controller-status-wait';
import { startControllerCommand } from './laser-interactive-command';
import type { LaserState, LiveRefs } from './laser-store';
import type { SafeWriteFn } from './laser-line-shared';

const OWNED_QUEUE_TIMEOUT_MS = 8_000;
const OWNED_QUEUE_POLL_MS = 10;

/** Prove one owned motion phase is physically settled before a later phase is
 * allowed onto the wire. The old command ack drains first, then the driver's
 * planner marker crosses, then a causally later Idle report is required. */
export async function settleOwnedMotionPhase(
  get: () => LaserState,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  operationId: number,
  label: string,
): Promise<void> {
  await waitForOwnedQueue(get, operationId, label);
  assertOwnedMotion(get, operationId, label);
  await startControllerCommand(refs, safeWrite, {
    kind: 'interactive-command',
    label: `${label} settle marker`,
    command: `${refs.driver.commands.settleDwell}\n`,
    action: 'jog',
    source: 'motion',
    timeoutMode: 'non-idle-status-activity',
  });
  assertOwnedMotion(get, operationId, label);

  const statusQuery =
    refs.driver.realtime.statusQuery ??
    (refs.driver.commands.queuedStatusQuery === null
      ? null
      : `${refs.driver.commands.queuedStatusQuery}\n`);
  if (statusQuery === null) {
    throw new Error(`${label} cannot confirm a fresh controller Idle on this driver.`);
  }
  const beforeQuery = get();
  const confirmation = waitForFreshControllerStatus(refs, {
    after: {
      sessionEpoch: beforeQuery.controllerSessionEpoch,
      sequence: beforeQuery.statusSequence,
    },
    accept: (report) => report.state === 'Idle',
    timeoutMessage: `Timed out waiting for ${label} to report settled Idle.`,
  });
  try {
    await Promise.all([safeWrite(statusQuery, undefined, 'poll'), confirmation]);
    await waitForOwnedQueue(get, operationId, label);
  } catch (error) {
    cancelFreshControllerStatusWait(refs, `${label} status confirmation was cancelled.`);
    throw error;
  }
  assertOwnedMotion(get, operationId, label);
}

function assertOwnedMotion(get: () => LaserState, operationId: number, label: string): void {
  const operation = get().motionOperation;
  if (operation?.operationId === operationId && operation.cancelRequested !== true) return;
  throw new Error(`${label} was cancelled or replaced before it physically settled.`);
}

async function waitForOwnedQueue(
  get: () => LaserState,
  operationId: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + OWNED_QUEUE_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    assertOwnedMotion(get, operationId, label);
    const state = get();
    if (
      state.pendingUntrackedAcks === 0 &&
      (state.pendingTransportWrites ?? 0) === 0 &&
      (state.motionOperation?.pendingMotionTransportWrites ?? 0) === 0
    ) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, OWNED_QUEUE_POLL_MS);
    });
  }
  throw new Error(`${label} is still waiting for its controller acknowledgement.`);
}
