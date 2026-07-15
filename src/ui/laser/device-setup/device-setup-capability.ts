import type { MachineKind } from '../../../core/scene';

export function deviceSetupSupportsMachineKind(
  state: { readonly machineKinds: ReadonlyArray<MachineKind> },
  machineKind: MachineKind,
): boolean {
  return state.machineKinds.includes(machineKind);
}
