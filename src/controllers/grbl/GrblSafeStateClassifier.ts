/**
 * T1-128: pure classifier for the GRBL safe-state-at-connect
 * verdict. Fourth slice of the audit's Sprint 4 controller-cleanup
 * sequence — first three were the parser trio (T1-124 status-report,
 * T1-126 settings, T1-127 WCS). This one moves out of the parser
 * lane into "extract safety classification" per the audit's
 * recommended sequence.
 *
 * Pre-T1-128 the logic lived as `_classifySafeStateReason` on the
 * GrblController class, reading `this._state` directly. Pure
 * extraction takes the relevant `MachineState` fields as input and
 * returns the same `UnsafeAtConnectReason | null` verdict — the
 * classifier doesn't need controller identity to do its job. The
 * controller's `_classifySafeStateReason` becomes a one-line
 * delegating shell.
 *
 * Why this matters for the audit: the verdict drives the
 * `MACHINE_UNSAFE_AT_CONNECT` preflight rule + the connection
 * panel's unsafe-at-connect banner. T1-115 (Door first-class
 * status), T1-122 (RecoveryState), and T1-117 (WCS fail-closed)
 * each touched this classifier; making it pure means future
 * audits can trace the safety logic without reading 2700 lines of
 * controller state.
 *
 * Door support is preserved (T1-115) — a live `<Door|...>` first
 * status report classifies as the distinct `'door'` reason whose
 * recovery action is "close the door / release the e-stop", not
 * `$X` unlock or M5.
 */
import type { MachineState } from '../ControllerInterface';
import type { UnsafeAtConnectReason } from './GrblController';

/**
 * Subset of MachineState the classifier reads. Carved out so the
 * pure function's signature doesn't accept arbitrary state — only
 * the fields whose values actually drive the verdict.
 */
export interface SafeStateClassifierInput {
  readonly status: MachineState['status'];
  readonly spindleSpeed: number;
  readonly feedRate: number;
}

/**
 * Classify the connect-time `MachineState` into an
 * `UnsafeAtConnectReason`, or null when the controller is in a
 * known-safe configuration (idle + FS 0,0).
 *
 * Reasons:
 *   - `'alarm'` — previous session ended in alarm; user must inspect.
 *   - `'run'` / `'hold'` — firmware thinks a job is active.
 *   - `'door'` — safety door / e-stop / lid switch is active
 *     (T1-115); recovery is user-action.
 *   - `'check'` — `$C` check-mode is on (motion parsed, not executed).
 *   - `'unsafe-residual-spindle'` — idle but FS reports non-zero
 *     spindle / feed (laser still in modal M3/M4 from a prior op).
 *   - `null` — idle + FS 0,0 (handshake passes); homing /
 *     connecting / disconnected / faulted yield no verdict (homing
 *     is a user-initiated startup cycle; faulted is T2-12 territory
 *     with its own gate).
 *
 * Pure: same input → same output. No state mutation. Caller
 * (controller) snapshots its `_state` and passes the relevant
 * fields in.
 */
export function classifyGrblSafeState(
  state: SafeStateClassifierInput,
): UnsafeAtConnectReason | null {
  if (state.status === 'alarm') return 'alarm';
  if (state.status === 'run') return 'run';
  if (state.status === 'hold') return 'hold';
  if (state.status === 'door') return 'door';
  if (state.status === 'check') return 'check';
  if (state.status === 'idle') {
    if (state.spindleSpeed !== 0 || state.feedRate !== 0) {
      return 'unsafe-residual-spindle';
    }
    return null;
  }
  // homing / connecting / disconnected / faulted_requires_inspection
  // → no verdict. The faulted state has its own T2-12 gate; homing
  // is a user-initiated startup; connecting/disconnected aren't
  // operational states for the safe-state-at-connect contract.
  return null;
}
