import type { DeviceProfile } from '../../core/devices';
import { explicitMachineKindsForProfile } from '../../core/devices/device-profile';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  LASER_MACHINE_CONFIG,
  machineKindOf,
  type CncMachineConfig,
  type CncTool,
  type MachineKind,
  type Project,
} from '../../core/scene';
import { cncMachineWithReusableTools } from './machine-actions';

export type ProjectMachineCapabilityLoadResult =
  | { readonly kind: 'loaded'; readonly projectBedReconciled?: boolean }
  | {
      readonly kind: 'capability-warning';
      readonly activeKind: MachineKind;
      readonly projectBedReconciled?: boolean;
    };

export type ProjectMachineCapabilityResolution = {
  readonly project: Project;
  readonly cachedCncMachine: CncMachineConfig | null;
  readonly loadResult: ProjectMachineCapabilityLoadResult;
};

export function resolveProjectMachineCapability(
  project: Project,
  customTools: ReadonlyArray<CncTool>,
  preferredKind: MachineKind = machineKindOf(project.machine),
): ProjectMachineCapabilityResolution {
  const currentKind = machineKindOf(project.machine);
  const selectedProject =
    preferredKind === currentKind
      ? project
      : { ...project, machine: machineForKind(project.device, preferredKind, customTools) };
  const selectedKind = machineKindOf(selectedProject.machine);
  const explicitKinds = explicitMachineKindsForProfile(selectedProject.device);
  const resolved = loadedProjectResolution(selectedProject, customTools);
  if (explicitKinds.length === 0 || explicitKinds.includes(selectedKind)) return resolved;
  return { ...resolved, loadResult: { kind: 'capability-warning', activeKind: selectedKind } };
}

function loadedProjectResolution(
  project: Project,
  customTools: ReadonlyArray<CncTool>,
): ProjectMachineCapabilityResolution {
  if (project.machine?.kind !== 'cnc') {
    return { project, cachedCncMachine: null, loadResult: { kind: 'loaded' } };
  }
  const machine = cncMachineWithReusableTools(project.machine, customTools);
  return {
    project: machine === project.machine ? project : { ...project, machine },
    cachedCncMachine: null,
    loadResult: { kind: 'loaded' },
  };
}

function machineForKind(
  device: DeviceProfile,
  machineKind: MachineKind,
  customTools: ReadonlyArray<CncTool>,
): typeof LASER_MACHINE_CONFIG | CncMachineConfig {
  if (machineKind === 'laser') return LASER_MACHINE_CONFIG;
  const machine =
    device.cncSubProfile === undefined
      ? DEFAULT_CNC_MACHINE_CONFIG
      : { ...DEFAULT_CNC_MACHINE_CONFIG, params: { ...device.cncSubProfile } };
  return cncMachineWithReusableTools(machine, customTools);
}
