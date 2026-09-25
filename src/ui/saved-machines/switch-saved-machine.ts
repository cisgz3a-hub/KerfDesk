// Switch the open project to a saved machine (ADR-374): every profile field is
// replaced in one undoable change, the same replacement Machine Setup's Save
// uses, so the switched project never keeps another machine's bed, origin,
// power range or dialect. The completed Frame always expires.

import {
  findSavedMachine,
  savedMachineKind,
  type SavedMachine,
} from '../../core/saved-machines/saved-machine-list';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  LASER_MACHINE_CONFIG,
  type CncMachineConfig,
  type MachineConfig,
  type MachineKind,
} from '../../core/scene';
import { useStore } from '../state';
import { useSavedMachinesStore } from '../state/saved-machines-store';
import { reconnectNeededFor } from './saved-machine-connection';
import {
  expireFrameAfterMachineChange,
  frameEvidencePresent,
  machineChangeBlocker,
} from './saved-machine-frame-expiry';

export type SavedMachineSwitchResult =
  | {
      readonly kind: 'switched';
      readonly machine: SavedMachine;
      /** The live connection uses another controller driver; reconnect. */
      readonly reconnect: boolean;
      /** Set when the profile does not declare the output mode it opened in. */
      readonly capabilityWarning: MachineKind | null;
    }
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'missing' };

export function switchToSavedMachine(
  id: string,
  options: { readonly machineKind?: MachineKind } = {},
): SavedMachineSwitchResult {
  const machine = findSavedMachine(useSavedMachinesStore.getState().list, id);
  if (machine === undefined) return { kind: 'missing' };
  const blocked = machineChangeBlocker();
  if (blocked !== null) return { kind: 'blocked', reason: blocked };
  const app = useStore.getState();
  const kind = savedMachineKind(machine.profile, options.machineKind ?? machine.machineKind);
  const configs = machineConfigsFor(app, machine, kind);
  const hadFrame = frameEvidencePresent();
  const result = app.replaceMachineSetup(machine.profile, configs.machine, configs.retainedCnc);
  expireFrameAfterMachineChange(machine.name, hadFrame);
  return {
    kind: 'switched',
    machine,
    reconnect: reconnectNeededFor(machine.profile),
    capabilityWarning:
      result.kind === 'applied-with-capability-warning' ? result.requestedKind : null,
  };
}

/** The saved spindle values ride on the CNC config because Machine Setup's
 * replacement copies CNC parameters from that config into the profile; the
 * project's own stock, bits and tiling stay as they are. */
function machineConfigsFor(
  app: ReturnType<typeof useStore.getState>,
  machine: SavedMachine,
  kind: MachineKind,
): { readonly machine: MachineConfig; readonly retainedCnc: CncMachineConfig } {
  const base =
    app.project.machine?.kind === 'cnc'
      ? app.project.machine
      : (app.cachedCncMachine ?? DEFAULT_CNC_MACHINE_CONFIG);
  const saved = machine.profile.cncSubProfile;
  const cnc: CncMachineConfig = saved === undefined ? base : { ...base, params: { ...saved } };
  return { machine: kind === 'cnc' ? cnc : LASER_MACHINE_CONFIG, retainedCnc: cnc };
}
