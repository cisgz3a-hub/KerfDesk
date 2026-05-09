/**
 * T2-40: central operation-gating authority. Pre-T2-40 operation
 * availability was implemented in 4-5 different places —
 * `src/app/ExecutionCoordinator.ts:46-242` (jog/unlock/home/test-
 * fire/set-origin), `src/app/MachineService.ts:574` (jog),
 * `src/core/preflight/` (some operation gates), various UI
 * components (some button-disabled checks). No single
 * `canExecuteOperation(operation, capabilities, machineState):
 * CapabilityDecision` authority.
 *
 * Concrete failures: UI button shows enabled by one rule but
 * service layer rejects via a different rule (confusing toast),
 * UI button disabled but service layer permits (dead button), or
 * adding a new gate requires touching every place that gates
 * operations.
 *
 * Audit 3C Finding 6.3 + Critical 8 + Required Priority 6.
 *
 * T2-40 ships the pure decision authority (Operation union +
 * CapabilityDecision discriminated union + canExecuteOperation
 * function + decision-message helper). Migrating UI buttons /
 * ExecutionCoordinator / MachineService callsites is filed as
 * T2-40-followup since each adoption is a per-callsite review.
 *
 * This pairs with T2-26 (move GRBL command construction out of
 * generic) and T3-47 (capability-gated safety operations) — both
 * consume the decision authority shipped here.
 */

import type { ControllerCapabilities } from '../controllers/ControllerCapabilities';

export type Operation =
  | 'home'
  | 'unlock'
  | 'jog'
  | 'set-origin'
  | 'frame-safe'
  | 'frame-dot'
  | 'test-fire'
  | 'autofocus'
  | 'wcs-normalize'
  | 'raw-console'
  | 'job-start'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'emergency-stop';

export type DecisionRefusalReason =
  | 'capability-not-supported'
  | 'machine-state-prevents'
  | 'capabilities-unknown'
  | 'profile-mismatch'
  | 'not-connected'
  | 'operation-busy';

export type CapabilityDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: DecisionRefusalReason;
      detail: string;
    };

/**
 * Snapshot of the machine state needed to make gating decisions.
 * Re-declared locally rather than importing the wider
 * MachineSafetyState union (T2-12) so this module stays a pure
 * gate without pulling in the safety state's many dependencies.
 */
export interface OperationGateMachineState {
  readonly connected: boolean;
  readonly status:
    | 'idle' | 'run' | 'hold' | 'jog' | 'alarm' | 'door'
    | 'check' | 'home' | 'sleep' | 'unknown';
  /** Active operation slot (T2-11). null = no operation in progress. */
  readonly activeOperation: Operation | null;
  /** True iff `$22` (homing-enabled) was observed; null = unknown. */
  readonly homingRequiredAtBoot?: boolean | null;
}

/** Operations that this gate knows about. Order is canonical. */
export const ALL_OPERATIONS: readonly Operation[] = [
  'home', 'unlock', 'jog', 'set-origin',
  'frame-safe', 'frame-dot', 'test-fire',
  'autofocus', 'wcs-normalize',
  'raw-console', 'job-start',
  'pause', 'resume', 'stop', 'emergency-stop',
] as const;

const ALLOW: CapabilityDecision = { allowed: true };

function refuse(reason: DecisionRefusalReason, detail: string): CapabilityDecision {
  return { allowed: false, reason, detail };
}

/**
 * Capability-driven dispatch — what controller-supported operations
 * each `Operation` requires. Pure lookup so callers don't repeat
 * the mapping inline.
 */
function operationCapabilityRequirement(
  op: Operation,
  caps: ControllerCapabilities,
): { supported: boolean; detail: string } {
  switch (op) {
    case 'home':
      return { supported: caps.operations.canHome, detail: 'Controller does not support homing.' };
    case 'unlock':
      return { supported: caps.operations.canUnlock, detail: 'Controller does not support unlock.' };
    case 'jog':
      return { supported: caps.operations.canJog, detail: 'Controller does not support jog.' };
    case 'set-origin':
      return { supported: caps.operations.canSetWorkOrigin, detail: 'Controller does not support setting work origin.' };
    case 'frame-safe':
    case 'frame-dot':
      return { supported: caps.operations.canFrame, detail: 'Controller does not support framing.' };
    case 'test-fire':
      return { supported: caps.operations.canTestFire, detail: 'Controller does not support test-fire.' };
    case 'autofocus':
      return { supported: caps.operations.canAutofocus, detail: 'Controller does not support autofocus.' };
    case 'pause':
      return { supported: caps.operations.canPause, detail: 'Controller does not support pause.' };
    case 'resume':
      return { supported: caps.operations.canResume, detail: 'Controller does not support resume.' };
    case 'stop':
      return { supported: caps.operations.canSoftStop, detail: 'Controller does not support soft stop.' };
    case 'emergency-stop':
      return { supported: caps.operations.canEmergencyStop, detail: 'Controller does not support emergency stop.' };
    case 'wcs-normalize':
    case 'raw-console':
      return { supported: true, detail: '' };  // app-level operations, not capability-gated
    case 'job-start': {
      const hasExecutableOutput =
        caps.output.supportsGcode
        || caps.output.supportsBinary
        || caps.output.formats.includes('gcode-text')
        || caps.output.formats.includes('gcode-binary')
        || caps.output.formats.includes('native-binary');
      return {
        supported: hasExecutableOutput,
        detail: 'Controller does not advertise an executable job output format.',
      };
    }
  }
}

/**
 * Machine-state gate — for each operation, is the current machine
 * state compatible? Pure logic; never queries the controller.
 */
function operationMachineStateGate(
  op: Operation,
  state: OperationGateMachineState,
): CapabilityDecision {
  if (!state.connected) {
    return refuse('not-connected', 'Controller is not connected.');
  }
  if (state.activeOperation != null && state.activeOperation !== op) {
    return refuse(
      'operation-busy',
      `Another operation is in progress (${state.activeOperation}).`,
    );
  }
  switch (op) {
    case 'home':
      // Allowed in idle/alarm/unknown — homing recovers from alarm.
      if (state.status === 'run' || state.status === 'jog' || state.status === 'hold') {
        return refuse('machine-state-prevents', `Cannot home while machine is '${state.status}'.`);
      }
      return ALLOW;
    case 'unlock':
      if (state.status !== 'alarm' && state.status !== 'idle') {
        return refuse('machine-state-prevents', `Unlock is meaningful only in 'alarm' state.`);
      }
      return ALLOW;
    case 'jog':
    case 'set-origin':
    case 'frame-safe':
    case 'frame-dot':
    case 'test-fire':
    case 'autofocus':
      if (state.status !== 'idle') {
        return refuse('machine-state-prevents', `Operation requires 'idle' state (current: '${state.status}').`);
      }
      return ALLOW;
    case 'pause':
      if (state.status !== 'run' && state.status !== 'jog') {
        return refuse('machine-state-prevents', `Pause requires 'run' state (current: '${state.status}').`);
      }
      return ALLOW;
    case 'resume':
      if (state.status !== 'hold') {
        return refuse('machine-state-prevents', `Resume requires 'hold' state (current: '${state.status}').`);
      }
      return ALLOW;
    case 'stop':
      // Stop is always permissible — it's the universal abort.
      return ALLOW;
    case 'emergency-stop':
      // Always permissible — emergency.
      return ALLOW;
    case 'wcs-normalize':
      if (state.status !== 'idle') {
        return refuse('machine-state-prevents', `WCS normalisation requires 'idle' state.`);
      }
      return ALLOW;
    case 'raw-console':
      // Operator-typed; permissibility is left to the operator (warning surface elsewhere).
      return ALLOW;
    case 'job-start':
      if (state.status !== 'idle') {
        return refuse('machine-state-prevents', `Cannot start a job while machine is '${state.status}'.`);
      }
      if (state.homingRequiredAtBoot === true) {
        return refuse('machine-state-prevents', 'Homing is required before the first job.');
      }
      return ALLOW;
  }
}

/**
 * Pure operation-gate decision. Order: not-connected check first,
 * then capability check, then machine-state check. Returns the
 * first refusal — callers showing the result get the most-specific
 * reason for the gate.
 */
export function canExecuteOperation(
  operation: Operation,
  capabilities: ControllerCapabilities,
  machineState: OperationGateMachineState,
): CapabilityDecision {
  if (!machineState.connected) {
    return refuse('not-connected', 'Controller is not connected.');
  }
  const capReq = operationCapabilityRequirement(operation, capabilities);
  if (!capReq.supported) {
    return refuse('capability-not-supported', capReq.detail);
  }
  return operationMachineStateGate(operation, machineState);
}

/**
 * Convenience: format a refusal as a UI tooltip / toast. Returns
 * null for `allowed: true`.
 */
export function decisionMessage(decision: CapabilityDecision): string | null {
  if (decision.allowed) return null;
  return decision.detail;
}

/**
 * UI-button helper: returns `true` iff the operation is currently
 * permissible. Equivalent to `canExecuteOperation(...).allowed` but
 * named for the call-site convention.
 */
export function isOperationAllowed(
  operation: Operation,
  capabilities: ControllerCapabilities,
  machineState: OperationGateMachineState,
): boolean {
  return canExecuteOperation(operation, capabilities, machineState).allowed;
}
