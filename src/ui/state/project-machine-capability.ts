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
import { cncMachineWithOwnFeeds } from '../../core/cnc/cnc-head-feeds';
import { cncMachineWithReusableTools } from './machine-actions';
import { projectForModeSwitch } from './mode-switch-settings';
import { projectWithParkedCnc } from './parked-cnc-machine';

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
  const selectedProject = projectForKind(project, preferredKind, customTools);
  const selectedKind = machineKindOf(selectedProject.machine);
  const explicitKinds = explicitMachineKindsForProfile(selectedProject.device);
  const resolved = loadedProjectResolution(selectedProject, customTools);
  if (explicitKinds.length === 0 || explicitKinds.includes(selectedKind)) return resolved;
  return { ...resolved, loadResult: { kind: 'capability-warning', activeKind: selectedKind } };
}

// A laser project hands its parked CNC setup back to the store, so the next
// switch to CNC restores the stock, bits and params the file was saved with.
function loadedProjectResolution(
  project: Project,
  customTools: ReadonlyArray<CncTool>,
): ProjectMachineCapabilityResolution {
  if (project.machine?.kind !== 'cnc') {
    const parked = project.parkedCncMachine;
    const cachedCncMachine =
      parked === undefined
        ? null
        : cncMachineWithOwnFeeds(cncMachineWithReusableTools(parked, customTools), project.device);
    return {
      project: projectWithParkedCnc(project, cachedCncMachine),
      cachedCncMachine,
      loadResult: { kind: 'loaded' },
    };
  }
  const machine = cncMachineWithOwnFeeds(
    cncMachineWithReusableTools(project.machine, customTools),
    project.device,
  );
  return {
    project: projectWithParkedCnc(
      machine === project.machine ? project : { ...project, machine },
      null,
    ),
    cachedCncMachine: null,
    loadResult: { kind: 'loaded' },
  };
}

function projectForKind(
  project: Project,
  machineKind: MachineKind,
  customTools: ReadonlyArray<CncTool>,
): Project {
  const currentKind = machineKindOf(project.machine);
  if (machineKind === currentKind) return project;
  const switched = projectForModeSwitch(project, currentKind, machineKind);
  if (machineKind === 'laser') {
    const parked = project.machine?.kind === 'cnc' ? project.machine : null;
    return projectWithParkedCnc({ ...switched, machine: LASER_MACHINE_CONFIG }, parked);
  }
  return { ...switched, machine: cncMachineFor(project, customTools) };
}

function cncMachineFor(project: Project, customTools: ReadonlyArray<CncTool>): CncMachineConfig {
  const subProfile = project.device.cncSubProfile;
  const machine =
    project.parkedCncMachine ??
    (subProfile === undefined
      ? DEFAULT_CNC_MACHINE_CONFIG
      : { ...DEFAULT_CNC_MACHINE_CONFIG, params: { ...subProfile } });
  return cncMachineWithReusableTools(machine, customTools);
}
