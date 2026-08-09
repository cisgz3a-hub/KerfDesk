// Global ownership for the Machine Setup dialog. Keeping the host at App
// level lets Artwork and Machine controls open the same draft workflow even
// when the opposite rail is collapsed or unmounted.

import { create } from 'zustand';
import type { DeviceSetupStep } from './device-setup-flow';

export type DeviceSetupHighlight = 'autofocus';

export type CncStartupSetupField =
  | 'material'
  | 'default-bit'
  | 'stock'
  | 'spindle-max'
  | 'spinup'
  | 'coolant'
  | 'safe-z'
  | 'park'
  | 'tiling'
  | 'tool-plan';

export type MachineSetupTarget =
  | {
      readonly kind: 'step';
      readonly step: DeviceSetupStep;
      readonly highlight?: DeviceSetupHighlight;
    }
  | { readonly kind: 'cnc'; readonly field: CncStartupSetupField };

export type MachineSetupDialogState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'open';
      readonly target: MachineSetupTarget;
      readonly requestId: number;
    };

type MachineSetupDialogStore = {
  readonly state: MachineSetupDialogState;
  readonly configuredRevision: number;
  readonly open: (target: MachineSetupTarget) => void;
  readonly close: () => void;
  readonly configurationRecorded: () => void;
};

const DEFAULT_TARGET: MachineSetupTarget = { kind: 'step', step: 'capability' };

export const useMachineSetupDialogStore = create<MachineSetupDialogStore>((set, get) => ({
  state: { kind: 'idle' },
  configuredRevision: 0,
  open: (target) => {
    const current = get().state;
    const requestId = current.kind === 'open' ? current.requestId + 1 : 1;
    set({ state: { kind: 'open', target, requestId } });
  },
  close: () => set({ state: { kind: 'idle' } }),
  configurationRecorded: () =>
    set((state) => ({ configuredRevision: state.configuredRevision + 1 })),
}));

/** Open the one global Machine Setup workflow at an exact section or CNC field. */
export function openMachineSetup(target: MachineSetupTarget = DEFAULT_TARGET): void {
  useMachineSetupDialogStore.getState().open(target);
}

export function closeMachineSetup(): void {
  useMachineSetupDialogStore.getState().close();
}

export function machineSetupInitialStep(target: MachineSetupTarget): DeviceSetupStep {
  return target.kind === 'cnc' ? 'cnc-setup' : target.step;
}

export function machineSetupHighlight(
  target: MachineSetupTarget,
): DeviceSetupHighlight | undefined {
  return target.kind === 'step' ? target.highlight : undefined;
}
