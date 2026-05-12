/**
 * T1-204: pure mode-derivation for the new `WorkflowPanel`.
 *
 * The panel's three-zone layout (top bar, mode content, footer) has
 * exactly one "mode" active at a time. The decision of which mode is
 * active is a pure function of observable state — no side effects,
 * no React. This module is the single source of truth for that
 * mapping so the routing is testable exhaustively in isolation.
 *
 * Mode precedence (top to bottom — first match wins):
 *
 *   1. !isConnected + isConnecting → 'connecting'
 *   2. !isConnected → 'disconnected'
 *   3. recoveryState.status !== 'none' → 'recovery'  (hard lock)
 *   4. machineStatus === 'alarm' → 'recovery'        (alarm is recovery)
 *   5. machineStatus === 'faulted_requires_inspection' → 'recovery'
 *   6. machineStatus === 'run' → 'running'
 *   7. machineStatus === 'hold' → 'paused'
 *   8. canStartJob → 'ready'
 *   9. fallthrough → 'setup'
 *
 * The precedence reflects the safety hierarchy: connection state
 * comes first (nothing else matters without a controller), then
 * recovery (hard lock per the user's design decision), then job
 * lifecycle (run / hold), then the idle states (ready vs. setup).
 */
import type { MachineStatus } from '../../../controllers/ControllerInterface';
import type { RecoveryState } from '../../../runtime/RecoveryState';

/**
 * The seven mode values. Mutually exclusive — every input produces
 * exactly one. Order in this union matches the visual progression
 * from "no machine" to "job running".
 */
export type PanelMode =
  | 'disconnected'
  | 'connecting'
  | 'recovery'
  | 'setup'
  | 'ready'
  | 'running'
  | 'paused';

/**
 * The state slice the derivation reads. Snapshot at render time;
 * caller (WorkflowPanel) gathers from refs / state / props and
 * passes them in. Anything not in this interface is irrelevant to
 * mode selection by construction.
 */
export interface PanelModeInput {
  readonly isConnected: boolean;
  /**
   * True during the handshake — between the user clicking Connect
   * and the controller reporting status. Distinct from isConnected
   * because we want a `connecting` mode (spinner + cancel) rather
   * than flashing the connect wizard.
   */
  readonly isConnecting: boolean;
  readonly machineStatus: MachineStatus | null;
  readonly recoveryState: RecoveryState;
  /**
   * Result of the existing `buildStartReadiness({...}).ready` check
   * AND `recoveryAllowsStart(recoveryState)`. Caller is responsible
   * for the conjunction — this module doesn't recompute readiness.
   */
  readonly canStartJob: boolean;
}

export function derivePanelMode(input: PanelModeInput): PanelMode {
  if (!input.isConnected) {
    return input.isConnecting ? 'connecting' : 'disconnected';
  }
  if (input.recoveryState.status !== 'none') return 'recovery';
  if (input.machineStatus === 'alarm') return 'recovery';
  if (input.machineStatus === 'faulted_requires_inspection') return 'recovery';
  if (input.machineStatus === 'run') return 'running';
  if (input.machineStatus === 'hold') return 'paused';
  if (input.canStartJob) return 'ready';
  return 'setup';
}

/**
 * Human-readable label for a mode, used in the top bar's mode
 * indicator and in test failure messages. Kept here (rather than in
 * the component) so tests can pin the labels without rendering.
 */
export function panelModeLabel(mode: PanelMode): string {
  switch (mode) {
    case 'disconnected': return 'Disconnected';
    case 'connecting': return 'Connecting';
    case 'recovery': return 'Recovery';
    case 'setup': return 'Setup';
    case 'ready': return 'Ready';
    case 'running': return 'Running';
    case 'paused': return 'Paused';
  }
}
