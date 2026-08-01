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
  | { readonly kind: 'loaded' }
  | {
      readonly kind: 'capability-repaired';
      readonly previousKind: MachineKind;
      readonly activeKind: MachineKind;
      readonly preservedCnc: boolean;
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
  const explicitKinds = explicitMachineKindsForProfile(project.device);
  const activeKind =
    explicitKinds.length === 1 ? (explicitKinds[0] ?? preferredKind) : preferredKind;
  const hasMatchingMachine =
    currentKind === activeKind && (activeKind === 'laser' || project.machine?.kind === 'cnc');
  if (hasMatchingMachine) {
    return loadedProjectResolution(project, customTools);
  }
  const cachedCncMachine = project.machine?.kind === 'cnc' ? project.machine : null;
  return {
    project: { ...project, machine: machineForKind(project.device, activeKind, customTools) },
    cachedCncMachine,
    loadResult: {
      kind: 'capability-repaired',
      previousKind: currentKind,
      activeKind,
      preservedCnc: cachedCncMachine !== null,
    },
  };
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
