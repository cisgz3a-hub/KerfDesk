// laser-session-reset — the single source of truth for "what belonged to the
// job that just ended" and "what belonged to the controller session that just
// died". Each teardown path used to repeat its own hand-written field list, and
// the lists drifted: a stale ALARM survived Disconnect and kept the alarm banner
// mounted against no controller, while the cached WCS and override readouts were
// dropped by a port close but not by Disconnect. Both patches now spread these
// factories so a newly added session-scoped field cannot be forgotten in one
// path and cleared in the other.

import type { LaserState } from './laser-store';

type FinishedJobState = Pick<
  LaserState,
  | 'activeJobMachineKind'
  | 'toolChangeIdleSeen'
  | 'toolChangeLabels'
  | 'toolChangeToolIds'
  | 'pendingToolLabel'
  | 'pendingToolId'
>;

type SessionScopedState = FinishedJobState &
  Pick<LaserState, 'alarmCode' | 'lastError' | 'activeWcs' | 'ovCache'>;

/**
 * State owned by ONE run. Cleared when a job reaches a terminal state — a
 * finished stream, an Abort, or a teardown — so the next Start never inherits
 * the previous run's machine kind or its unconsumed tool-change queue.
 */
export function finishedJobStateReset(): FinishedJobState {
  return {
    activeJobMachineKind: null,
    toolChangeIdleSeen: false,
    toolChangeLabels: [],
    toolChangeToolIds: [],
    pendingToolLabel: null,
    pendingToolId: null,
  };
}

/**
 * State owned by ONE controller session. Adds the firmware-reported values that
 * only mean something while the port is open: the latched fault codes, and the
 * modal/override readouts GRBL reports on an intermittent cadence. GRBL
 * re-initializes its parser state on reset, so none of these survive the
 * session that produced them.
 */
export function sessionScopedJobStateReset(): SessionScopedState {
  return {
    ...finishedJobStateReset(),
    alarmCode: null,
    lastError: null,
    activeWcs: null,
    ovCache: null,
  };
}
