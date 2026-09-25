// Which machine a new project starts with (ADR-374). LightBurn's Set Default
// picks the device that is active when it launches; KerfDesk applies the
// default saved machine to the blank project at launch and to File > New.
// Without a default, New keeps the machine that is already open.

import type { DeviceProfile } from '../../core/devices';
import { defaultSavedMachine } from '../../core/saved-machines/saved-machine-list';
import { createProject, type MachineKind, type Project } from '../../core/scene';
import { resolveProjectMachineCapability } from './project-machine-capability';
import { useSavedMachinesStore } from './saved-machines-store';

export type NewProjectMachine = {
  readonly device: DeviceProfile;
  readonly machineKind: MachineKind;
};

export function newProjectMachine(current: NewProjectMachine): NewProjectMachine {
  const saved = defaultSavedMachine(useSavedMachinesStore.getState().list);
  return saved === undefined ? current : { device: saved.profile, machineKind: saved.machineKind };
}

export function startupProject(): Project {
  const saved = defaultSavedMachine(useSavedMachinesStore.getState().list);
  if (saved === undefined) return createProject();
  return resolveProjectMachineCapability(createProject(saved.profile), [], saved.machineKind)
    .project;
}
