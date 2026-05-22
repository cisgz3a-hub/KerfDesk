import { buildControllerPanelModel } from '../src/machine-control-v2/ControllerPanelAdapter';

const model = buildControllerPanelModel({
  state: 'idle',
  capabilities: {
    canStart: true,
    canPause: true,
    canResume: true,
    canStop: true,
    canEmergencyStop: true,
    canJog: true,
    canHome: true,
    canUnlock: true,
    canResetWcs: true,
    canTestFire: true,
    canFrame: true,
  },
  hasValidatedTicket: true,
  hasFrameProof: true,
});

if (!model.buttons.start.enabled) {
  throw new Error('start should be enabled');
}
if (!model.buttons.resetWcs.enabled) {
  throw new Error('reset WCS should be enabled');
}
if (model.buttons.pause.enabled) {
  throw new Error('pause should be disabled while idle');
}
