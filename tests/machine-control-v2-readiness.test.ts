import type { ControllerCapabilitiesV2 } from '../src/machine-control-v2/ControllerCapabilitiesV2';
import { getMachineReadiness } from '../src/machine-control-v2/MachineReadiness';

const caps: ControllerCapabilitiesV2 = {
  canStart: true,
  canPause: true,
  canResume: true,
  canStop: true,
  canEmergencyStop: true,
  canJog: true,
  canHome: false,
  canUnlock: true,
  canResetWcs: true,
  canTestFire: true,
  canFrame: true,
};

const idle = getMachineReadiness({
  state: 'idle',
  capabilities: caps,
  hasValidatedTicket: true,
  hasFrameProof: true,
});
if (!idle.start.enabled) {
  throw new Error('start should be enabled');
}
if (!idle.jog.enabled) {
  throw new Error('jog should be enabled');
}
if (idle.home.enabled) {
  throw new Error('home should be disabled without capability');
}

const streaming = getMachineReadiness({
  state: 'streaming',
  capabilities: caps,
  hasValidatedTicket: true,
  hasFrameProof: true,
});
if (streaming.start.enabled) {
  throw new Error('start must be disabled while streaming');
}
if (!streaming.pause.enabled) {
  throw new Error('pause should be enabled while streaming');
}
if (!streaming.stop.enabled) {
  throw new Error('stop should be enabled while streaming');
}
if (streaming.jog.enabled) {
  throw new Error('jog must be disabled while streaming');
}
