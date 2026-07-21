import type { StatusReport } from '../../core/controllers/grbl';
import {
  cancelFreshControllerStatusWait,
  waitForFreshControllerStatus,
  type ControllerStatusStamp,
} from './laser-controller-status-wait';
import { startControllerCommand } from './laser-interactive-command';
import type { LaserMotionOperationId } from './laser-motion-operation';
import type { LaserState, LiveRefs } from './laser-store';
import type { SafeWriteFn } from './laser-line-shared';

const OWNED_QUEUE_TIMEOUT_MS = 8_000;
const OWNED_QUEUE_POLL_MS = 10;

type SettlementContext = {
  readonly get: () => LaserState;
  readonly refs: LiveRefs;
  readonly safeWrite: SafeWriteFn;
  readonly operationId: LaserMotionOperationId;
  readonly label: string;
};

/** Prove one owned motion phase is physically settled before a later phase is
 * allowed onto the wire. The old command ack drains first, then a fresh Idle
 * report must prove the controller actually left Jog (GRBL acks `$J=` at parse
 * time, so a drained ledger is not motion-stopped proof, and GRBL rejects the
 * G4 marker while jogging — same fence as the ADR-231 §4 cancel path), then
 * the driver's planner marker crosses, then a causally later Idle report is
 * required. */
export async function settleOwnedMotionPhase(
  get: () => LaserState,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  operationId: LaserMotionOperationId,
  label: string,
): Promise<void> {
  const context: SettlementContext = { get, refs, safeWrite, operationId, label };
  await waitForOwnedQueue(get, operationId, label);
  assertOwnedMotion(get, operationId, label);
  const statusQuery = resolveStatusQuery(refs);
  if (statusQuery === null) {
    throw new Error(`${label} cannot confirm a fresh controller Idle on this driver.`);
  }
  // Stamped after the ack drain: only a status report newer than this is
  // causally after the controller parsed (and acked) the phase command.
  const ackStamp: ControllerStatusStamp = {
    sessionEpoch: get().controllerSessionEpoch,
    sequence: get().statusSequence,
  };
  await waitForIdleBeforeMarker(context, statusQuery, ackStamp);
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
  await probeControllerStatus(context, {
    statusQuery,
    accept: (report) => report.state === 'Idle',
    timeoutMessage: `Timed out waiting for ${label} to report settled Idle.`,
  });
  await waitForOwnedQueue(get, operationId, label);
  assertOwnedMotion(get, operationId, label);
}

// GRBL acknowledges $J= when it parses the line, not when the motion ends, so
// the drained ack ledger can coexist with a controller still in Jog — where a
// G4 settlement marker is rejected. Require a fresh Idle report, actively
// probing status, before the marker may cross (mirrors the ADR-231 §4
// waitForCancelledMotionIdleBeforeMarker fence, minus the cancel re-send).
async function waitForIdleBeforeMarker(
  context: SettlementContext,
  statusQuery: string,
  ackStamp: ControllerStatusStamp,
): Promise<void> {
  const deadline = Date.now() + OWNED_QUEUE_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    assertOwnedMotion(context.get, context.operationId, context.label);
    // Already settled: a report newer than the phase ack says Idle (for
    // example the background poller observed it first). Never wait for an
    // Idle "transition" that will not come.
    if (hasFreshIdleReport(context.get(), ackStamp)) return;
    const report = await probeControllerStatus(context, {
      statusQuery,
      accept: () => true,
      timeoutMs: Math.max(1, deadline - Date.now()),
      timeoutMessage: idleFenceTimeoutMessage(context.label),
    });
    if (report.state === 'Idle') return;
    await sleep(OWNED_QUEUE_POLL_MS);
  }
  throw new Error(idleFenceTimeoutMessage(context.label));
}

function idleFenceTimeoutMessage(label: string): string {
  return `Timed out waiting for ${label} to report Idle before its settle marker.`;
}

function hasFreshIdleReport(state: LaserState, stamp: ControllerStatusStamp): boolean {
  return (
    state.statusReport?.state === 'Idle' &&
    state.controllerSessionEpoch === stamp.sessionEpoch &&
    state.statusSequence > stamp.sequence
  );
}

type ControllerStatusProbe = {
  readonly statusQuery: string;
  readonly accept: (report: StatusReport) => boolean;
  readonly timeoutMs?: number;
  readonly timeoutMessage: string;
};

async function probeControllerStatus(
  context: SettlementContext,
  probe: ControllerStatusProbe,
): Promise<StatusReport> {
  const beforeQuery = context.get();
  const confirmation = waitForFreshControllerStatus(context.refs, {
    after: {
      sessionEpoch: beforeQuery.controllerSessionEpoch,
      sequence: beforeQuery.statusSequence,
    },
    accept: probe.accept,
    ...(probe.timeoutMs === undefined ? {} : { timeoutMs: probe.timeoutMs }),
    timeoutMessage: probe.timeoutMessage,
  });
  try {
    const [, report] = await Promise.all([
      context.safeWrite(probe.statusQuery, undefined, 'poll'),
      confirmation,
    ]);
    return report;
  } catch (error) {
    cancelFreshControllerStatusWait(
      context.refs,
      `${context.label} status confirmation was cancelled.`,
    );
    throw error;
  }
}

function resolveStatusQuery(refs: LiveRefs): string | null {
  return (
    refs.driver.realtime.statusQuery ??
    (refs.driver.commands.queuedStatusQuery === null
      ? null
      : `${refs.driver.commands.queuedStatusQuery}\n`)
  );
}

function assertOwnedMotion(
  get: () => LaserState,
  operationId: LaserMotionOperationId,
  label: string,
): void {
  const operation = get().motionOperation;
  if (operation?.operationId === operationId && operation.cancelRequested !== true) return;
  throw new Error(`${label} was cancelled or replaced before it physically settled.`);
}

async function waitForOwnedQueue(
  get: () => LaserState,
  operationId: LaserMotionOperationId,
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
    await sleep(OWNED_QUEUE_POLL_MS);
  }
  throw new Error(`${label} is still waiting for its controller acknowledgement.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
