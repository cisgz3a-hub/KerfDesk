import type { DeviceProfile } from '../../core/devices';
import type { MachineConfig, Project } from '../../core/scene';

export type ProjectBedReconciliationNotice = {
  readonly previousDevice: DeviceProfile;
  readonly previousMachine: MachineConfig | undefined;
  readonly openedDeviceName: string;
  readonly previousDeviceName: string;
  readonly openedWorkspace: { readonly width: number; readonly height: number };
  readonly openedBed: { readonly width: number; readonly height: number };
  readonly workspaceMismatch: boolean;
  readonly machineChanged: boolean;
};

export function canonicalizeOpenedProjectBed(
  project: Project,
  previous: Project,
): { readonly project: Project; readonly notice: ProjectBedReconciliationNotice | null } {
  const openedWorkspace = {
    width: project.workspace.width,
    height: project.workspace.height,
  };
  const openedBed = { width: project.device.bedWidth, height: project.device.bedHeight };
  const workspaceMismatch =
    openedWorkspace.width !== openedBed.width || openedWorkspace.height !== openedBed.height;
  const machineChanged = deviceIdentity(project.device) !== deviceIdentity(previous.device);
  const canonicalProject = workspaceMismatch
    ? {
        ...project,
        workspace: { ...project.workspace, width: openedBed.width, height: openedBed.height },
      }
    : project;
  if (!workspaceMismatch && !machineChanged) return { project: canonicalProject, notice: null };
  return {
    project: canonicalProject,
    notice: {
      previousDevice: previous.device,
      previousMachine: previous.machine,
      openedDeviceName: project.device.name,
      previousDeviceName: previous.device.name,
      openedWorkspace,
      openedBed,
      workspaceMismatch,
      machineChanged,
    },
  };
}

function deviceIdentity(device: DeviceProfile): string {
  return [device.profileId ?? '', device.name, device.bedWidth, device.bedHeight].join('|');
}
