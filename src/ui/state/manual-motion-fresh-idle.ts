import type { StatusReport } from '../../core/controllers/grbl';
import {
  cancelFreshControllerStatusWait,
  waitForFreshControllerStatus,
  type ControllerStatusStamp,
} from './laser-controller-status-wait';
import type { LiveRefs, LaserState } from './laser-store';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { TranscriptSource } from './laser-transcript';
import { pendingTransportWriteCount } from './laser-start-queue-fence';
import {
  assertManualMotionNotCancelled,
  markManualMotionStatusWaitCancellable,
} from './manual-motion-intent';

type GetFn = () => LaserState;
type WriteFn = (
  line: string,
  action: LaserSafetyAction | undefined,
  source: TranscriptSource,
) => Promise<void>;
type ManualMotionRefs = Pick<LiveRefs, 'driver' | 'controllerStatusWait'>;
type FreshIdleArgs = {
  readonly get: GetFn;
  readonly refs: ManualMotionRefs;
  readonly write: WriteFn;
  readonly action: Extract<LaserSafetyAction, 'jog' | 'frame' | 'origin' | 'console'>;
  readonly source?: TranscriptSource;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  /** Jog/Frame only: the manual-motion cancel generation captured before this
   * check. A Cancel that arrives while the query is outstanding fails it at
   * once (see manual-motion-intent). */
  readonly cancelGeneration?: number;
};
type StatusAnswer = { readonly report: StatusReport; readonly stamp: ControllerStatusStamp };

/** Maximum age accepted for a same-session cached Idle observation. */
export const MANUAL_MOTION_STATUS_MAX_AGE_MS = 1_000;
/** Operator guidance when a fresh status query cannot prove manual-motion readiness. */
export const MANUAL_MOTION_STATUS_TIMEOUT_MESSAGE =
  'Manual motion could not obtain a fresh same-session controller status after its status query. Check the connection and try again.';
/** The driver has no status query at all, so nothing was sent to wait for. */
export const MANUAL_MOTION_STATUS_UNAVAILABLE_MESSAGE =
  'Manual motion needs a current controller status report, and this controller has no status query KerfDesk can send. Wait for its next position report and try again.';

const DEFAULT_STATUS_TIMEOUT_MS = 3_000;
const QUEUED_QUERY_ACK_POLL_MS = 10;

/** Proves same-session fresh Idle immediately before an app-owned manual motion command. */
export async function confirmFreshManualMotionIdle(args: FreshIdleArgs): Promise<StatusReport> {
  const before = args.get();
  const now = (args.now ?? Date.now)();
  const cachedIdle = freshCachedIdle(before, before.statusObservation, now);
  if (cachedIdle !== null) return cachedIdle;

  const realtimeQuery = args.refs.driver.realtime.statusQuery;
  const { report, stamp } =
    realtimeQuery === null
      ? await queryQueuedStatus(args)
      : await queryRealtimeStatus(args, realtimeQuery);
  const current = args.get();
  if (current.controllerSessionEpoch !== stamp.sessionEpoch) {
    throw new Error('Controller session changed before manual motion could start.');
  }
  if (report.state !== 'Idle') {
    throw new Error(
      `Manual motion requires a fresh Idle report; the controller reported ${report.state}.`,
    );
  }
  return report;
}

async function queryRealtimeStatus(args: FreshIdleArgs, query: string): Promise<StatusAnswer> {
  await args.write(query, args.action, args.source ?? 'motion');
  assertStillWanted(args);
  const afterWrite = args.get();
  const stamp = {
    sessionEpoch: afterWrite.controllerSessionEpoch,
    sequence: afterWrite.statusSequence,
  };
  const confirmation = waitForFreshControllerStatus(args.refs, {
    after: stamp,
    accept: () => true,
    timeoutMs: args.timeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS,
    timeoutMessage: MANUAL_MOTION_STATUS_TIMEOUT_MESSAGE,
  });
  markCancellableWait(args);
  return { report: await confirmation, stamp };
}

// Marlin has no realtime status byte, only the queued M114. Refusing whenever
// the cached report aged past the window refused Jog, Frame, origin and
// Console commands with a message claiming a query had been sent, while the
// controller could answer M114 at once (audit status-5 / settings-console-6).
// M114 is an ordinary queued line that reports position and then owes its own
// `ok` (https://marlinfw.org/docs/gcode/M114.html), so the wait is registered
// before the write and the query's ack must drain before motion is written.
async function queryQueuedStatus(args: FreshIdleArgs): Promise<StatusAnswer> {
  const queuedQuery = args.refs.driver.commands.queuedStatusQuery;
  if (queuedQuery === null) throw new Error(MANUAL_MOTION_STATUS_UNAVAILABLE_MESSAGE);
  const timeoutMs = args.timeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const beforeQuery = args.get();
  const stamp = {
    sessionEpoch: beforeQuery.controllerSessionEpoch,
    sequence: beforeQuery.statusSequence,
  };
  const confirmation = waitForFreshControllerStatus(args.refs, {
    after: stamp,
    accept: () => true,
    timeoutMs,
    timeoutMessage: MANUAL_MOTION_STATUS_TIMEOUT_MESSAGE,
  });
  const ownedWait = args.refs.controllerStatusWait;
  markCancellableWait(args);
  try {
    const [, report] = await Promise.all([
      args.write(`${queuedQuery}\n`, args.action, args.source ?? 'motion'),
      confirmation,
    ]);
    await waitForQueuedQueryAck(args, deadline);
    return { report, stamp };
  } catch (error) {
    if (ownedWait != null && args.refs.controllerStatusWait === ownedWait) {
      cancelFreshControllerStatusWait(args.refs, MANUAL_MOTION_STATUS_TIMEOUT_MESSAGE);
    }
    throw error;
  }
}

async function waitForQueuedQueryAck(args: FreshIdleArgs, deadline: number): Promise<void> {
  for (;;) {
    assertStillWanted(args);
    const state = args.get();
    if ((state.pendingUntrackedAcks ?? 0) === 0 && pendingTransportWriteCount(state) === 0) return;
    if (Date.now() >= deadline) throw new Error(MANUAL_MOTION_STATUS_TIMEOUT_MESSAGE);
    await new Promise((resolve) => setTimeout(resolve, QUEUED_QUERY_ACK_POLL_MS));
  }
}

function assertStillWanted(args: FreshIdleArgs): void {
  if (args.cancelGeneration !== undefined) {
    assertManualMotionNotCancelled(args.refs, args.cancelGeneration);
  }
}

function markCancellableWait(args: FreshIdleArgs): void {
  if (args.cancelGeneration !== undefined) markManualMotionStatusWaitCancellable(args.refs);
}

function freshCachedIdle(
  state: LaserState,
  observation: LaserState['statusObservation'],
  now: number,
): StatusReport | null {
  const report = state.statusReport;
  const fresh =
    report?.state === 'Idle' &&
    observation !== null &&
    observation.sessionEpoch === state.controllerSessionEpoch &&
    observation.positionEpoch === (state.trustedPositionEpoch ?? 0) &&
    now - observation.observedAt <= MANUAL_MOTION_STATUS_MAX_AGE_MS;
  return fresh ? report : null;
}
