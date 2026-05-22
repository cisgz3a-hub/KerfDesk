import type { ControllerCapabilitiesV2 } from './ControllerCapabilitiesV2';
import type { Axis, MachineIntent } from './MachineIntent';
import type { MachineControlState } from './MachineStateMachine';
import { getMachineReadiness } from './MachineReadiness';

export type MachineControlV2Dispatch = (intent: MachineIntent) => void | Promise<void>;

export function buildControllerPanelModel(args: {
  state: MachineControlState;
  capabilities: ControllerCapabilitiesV2;
  hasValidatedTicket: boolean;
  hasFrameProof: boolean;
}) {
  return {
    buttons: getMachineReadiness(args),
  };
}

export function createResetWcsToBaselineIntent(
  axes: readonly Axis[] = ['X', 'Y'],
): Extract<MachineIntent, { kind: 'resetWcsToBaseline' }> {
  return { kind: 'resetWcsToBaseline', axes };
}

export function dispatchResetWcsToBaseline(
  dispatch: MachineControlV2Dispatch,
): void | Promise<void> {
  return dispatch(createResetWcsToBaselineIntent());
}
