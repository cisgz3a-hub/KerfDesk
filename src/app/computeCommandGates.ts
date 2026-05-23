/**
 * T1-30: centralized command-gate computation.
 *
 * Pre-T1-30 every UI surface had its own `isConnected && !isRunning` ad-hoc
 * gate for laser-on operations. Each surface re-derived "is it safe to
 * fire?" from the same primitives but with subtle drift — `canFrame` at
 * one site, `canAutoFocus` at another, `canFire` (test-fire) at a third,
 * each missing different inputs (alarm state, laser modal state, active
 * operation, error code, recovery pending). The audit's framing was
 * correct: safety should not depend on every UI site doing the same
 * conjunction independently.
 *
 * This module produces a single map of base-safety gates derived from
 * four state inputs:
 *
 *   - `state` (T1-22): MachineState — controller status, error code.
 *   - `laserOutput` (T1-22): off / on / unknown.
 *   - `activeOperation` (T2-11): the temporary-laser-on mutex holder, or
 *     null. Set by jog / frame / frameDot / testFire / autoFocus /
 *     setOrigin acquire-paths in ExecutionCoordinator; cleared on
 *     release. The mutex itself prevents service-level overlap; the
 *     gate map prevents the UI from offering buttons that would just
 *     fail at the mutex layer.
 *   - `recoveryPending` (T1-29): the persisted unsafe-prior-state flag
 *     hasn't been acknowledged. Today the App.tsx alert modal blocks
 *     all UI while the flag is set, so this conjunct is mostly
 *     belt-and-suspenders for non-modal future recovery surfaces (T3-91).
 *
 * The output is consumed at every gate site:
 *   - `baseSafe`: the AND of all four "safe to start a temporary laser
 *     operation" conditions. Use this directly when the gate has no
 *     additional product-level gates beyond base safety.
 *   - `canJog` / `canFrameSafe` / `canFrameDot` / `canTestFire`: same as
 *     baseSafe today; named separately so per-operation refinements
 *     (e.g. "frameSafe doesn't require user consent" — which it
 *     already doesn't, see T1-30 spec note) can diverge later without
 *     touching call sites.
 *   - `canPause` / `canResume`: status-specific gates; fire only when
 *     the controller is in the matching state. baseSafe doesn't apply
 *     because pause/resume are themselves state transitions out of
 *     non-safe states (run → hold → run).
 *   - `canStop` / `canEmergencyStop`: always allowed if connected,
 *     even from alarm / hold / faulted. Stop is the recovery action;
 *     gating it on baseSafe would create deadlock.
 *   - `canUnlock`: only when status is 'alarm'. $X clears the alarm.
 *
 * Job-start (`canStartJob`) is NOT in this map because it has its own
 * product-level conjuncts (gcode exists, fresh, framed,
 * machineBlocksJobStart, placementUncertain, etc.) that don't generalize
 * to other operations. The job-start site AND-combines `gates.baseSafe`
 * with those product-level gates.
 *
 * Pure function — no side effects, no React, no fetches. Easy to unit
 * test against arbitrary state combinations.
 */
import type { MachineState } from '../controllers/ControllerInterface';
import type { LaserOutputState, ActiveOperationState } from './MachineService';

export interface CommandGatesInput {
  state: MachineState;
  laserOutput: LaserOutputState;
  activeOperation: ActiveOperationState | null;
  recoveryPending: boolean;
}

export interface CommandGates {
  /**
   * AND of: status === 'idle' && laserOutput === 'off' && no active
   * operation && no errorCode && !recoveryPending. The base for all
   * temporary-laser-on operations. Call sites that have additional
   * product-level conjuncts (e.g. canStartJob's gcode-fresh check)
   * AND-combine with this.
   */
  baseSafe: boolean;

  canJog: boolean;
  canFrameSafe: boolean;
  canFrameDot: boolean;
  canTestFire: boolean;

  /** True when controller status is active motion: 'run' or 'jog'. */
  canPause: boolean;
  /** True only when controller status === 'hold'. */
  canResume: boolean;

  /**
   * True if connected. Stop is always allowed when there's a controller
   * to stop; gating on baseSafe would block the recovery path itself.
   */
  canStop: boolean;
  canEmergencyStop: boolean;

  /** True only when controller status === 'alarm'. $X is the unlock command. */
  canUnlock: boolean;
}

export function computeCommandGates(input: CommandGatesInput): CommandGates {
  const { state, laserOutput, activeOperation, recoveryPending } = input;
  const baseSafe =
    state.status === 'idle' &&
    laserOutput === 'off' &&
    activeOperation === null &&
    state.errorCode == null &&
    !recoveryPending;

  const isConnected = state.status !== 'disconnected' && state.status !== 'connecting';

  return {
    baseSafe,
    canJog: baseSafe,
    canFrameSafe: baseSafe,
    canFrameDot: baseSafe,
    canTestFire: baseSafe,
    canPause: state.status === 'run' || state.status === 'jog',
    canResume: state.status === 'hold',
    canStop: isConnected,
    canEmergencyStop: isConnected,
    canUnlock: state.status === 'alarm',
  };
}
