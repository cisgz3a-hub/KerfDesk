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
  | 'pauseResumeTransition'
  | 'toolChangeIdleSeen'
  | 'toolChangeLabels'
  | 'toolChangeToolIds'
  | 'pendingToolLabel'
  | 'pendingToolId'
  | 'streamHold'
  | 'cncPauseLift'
>;

type SessionScopedState = FinishedJobState &
  Pick<
    LaserState,
    | 'alarmCode'
    | 'resetRequired'
    | 'lastError'
    | 'activeWcs'
    | 'ovCache'
    | 'rxCapacityEvidence'
    | 'plannerCapacityEvidence'
  >;

/**
 * State owned by ONE run. Cleared when a job reaches a terminal state — a
 * finished stream, an Abort, or a teardown — so the next Start never inherits
 * the previous run's machine kind or its unconsumed tool-change queue.
 */
export function finishedJobStateReset(): FinishedJobState {
  return {
    activeJobMachineKind: null,
    pauseResumeTransition: null,
    toolChangeIdleSeen: false,
    toolChangeLabels: [],
    toolChangeToolIds: [],
    pendingToolLabel: null,
    pendingToolId: null,
    streamHold: null,
    cncPauseLift: null,
  };
}

/**
 * The three Frame proofs a physical or setup mutation voids together: the
 * compatibility bounds proof, the exact permit, and a trace still waiting for
 * its exact program (ADR-353). Spread it wherever a machine or setup change
 * invalidates Frame evidence. A clear scoped to one specific permit does not
 * need it: a permit and a trace never coexist, because every Frame dispatch
 * clears both and minting a permit consumes the trace.
 */
export function frameProofReset(): Pick<
  LaserState,
  'frameVerification' | 'framedRun' | 'frameTrace'
> {
  return { frameVerification: null, framedRun: null, frameTrace: null };
}

/**
 * State owned by ONE controller session. Adds the firmware-reported values that
 * only mean something while the port is open: the latched fault codes, and the
 * modal/override readouts GRBL reports on an intermittent cadence, and the
 * RX and planner capacities proved by `Bf:` reports (a reconnect may boot
 * different firmware with different buffers). GRBL re-initializes its parser
 * state on reset, so none of these survive the session that produced them.
 */
export function sessionScopedJobStateReset(): SessionScopedState {
  return {
    ...finishedJobStateReset(),
    alarmCode: null,
    resetRequired: false,
    lastError: null,
    activeWcs: null,
    ovCache: null,
    rxCapacityEvidence: null,
    plannerCapacityEvidence: null,
  };
}
