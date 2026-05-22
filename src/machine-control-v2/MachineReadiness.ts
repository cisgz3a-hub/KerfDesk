import type { ControllerCapabilitiesV2 } from './ControllerCapabilitiesV2';
import type { MachineControlState } from './MachineStateMachine';

export interface ReadinessButton {
  readonly enabled: boolean;
  readonly reason: string;
}

export interface MachineReadiness {
  readonly start: ReadinessButton;
  readonly pause: ReadinessButton;
  readonly resume: ReadinessButton;
  readonly stop: ReadinessButton;
  readonly emergencyStop: ReadinessButton;
  readonly jog: ReadinessButton;
  readonly home: ReadinessButton;
  readonly unlock: ReadinessButton;
  readonly resetWcs: ReadinessButton;
  readonly testFire: ReadinessButton;
  readonly frame: ReadinessButton;
}

export function getMachineReadiness(args: {
  state: MachineControlState;
  capabilities: ControllerCapabilitiesV2;
  hasValidatedTicket: boolean;
  hasFrameProof: boolean;
}): MachineReadiness {
  const { state, capabilities, hasValidatedTicket, hasFrameProof } = args;
  const idle = state === 'idle';
  const streaming = state === 'streaming';
  const hold = state === 'hold';
  const alarm = state === 'alarm';

  return {
    start: button(
      capabilities.canStart && idle && hasValidatedTicket && hasFrameProof,
      'Start requires idle machine, validated ticket, and frame proof.',
    ),
    pause: button(
      capabilities.canPause && streaming,
      'Pause requires active streaming job.',
    ),
    resume: button(
      capabilities.canResume && hold,
      'Resume requires paused/hold state.',
    ),
    stop: button(
      capabilities.canStop &&
        (streaming || hold || state === 'framing' || state === 'testFiring'),
      'Stop requires active operation.',
    ),
    emergencyStop: button(
      capabilities.canEmergencyStop && state !== 'disconnected',
      'Emergency stop requires a connected controller.',
    ),
    jog: button(capabilities.canJog && idle, 'Jog requires idle machine.'),
    home: button(
      capabilities.canHome && idle,
      'Home not supported or machine not idle.',
    ),
    unlock: button(
      capabilities.canUnlock && alarm,
      'Unlock requires alarm state.',
    ),
    resetWcs: button(
      capabilities.canResetWcs && idle,
      'WCS reset requires idle machine.',
    ),
    testFire: button(
      capabilities.canTestFire && idle,
      'Test fire requires idle machine.',
    ),
    frame: button(capabilities.canFrame && idle, 'Frame requires idle machine.'),
  };
}

function button(enabled: boolean, disabledReason: string): ReadinessButton {
  return enabled
    ? { enabled: true, reason: '' }
    : { enabled: false, reason: disabledReason };
}
