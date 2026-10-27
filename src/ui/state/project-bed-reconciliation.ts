import type { DeviceProfile } from '../../core/devices';
import type { CncMachineParams, MachineConfig, Project } from '../../core/scene';

export type ProjectBedReconciliationNotice = {
  readonly previousDevice: DeviceProfile;
  readonly previousMachine: MachineConfig | undefined;
  readonly previousCncParams: CncMachineParams | undefined;
  readonly openedDeviceName: string;
  readonly previousDeviceName: string;
  readonly openedWorkspace: { readonly width: number; readonly height: number };
  readonly openedBed: { readonly width: number; readonly height: number };
  readonly workspaceMismatch: boolean;
  readonly machineChanged: boolean;
  /** The same profile id and name, so only the bed size tells the two apart (ADR-440 Amendment 5). */
  readonly bedSizeOnly: boolean;
  /** The opened machine's camera calibration differs from the current one's; null when not. */
  readonly camera: CameraCalibrationChange | null;
};

export type CameraCalibrationChange = {
  /** When the file's calibration was made; null when it brings none. */
  readonly openedCalibratedAt: string | null;
  /** When the current machine's calibration was made; null when it has none. */
  readonly currentCalibratedAt: string | null;
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
      // Older accepted projects can have a missing or stale device mirror.
      // Capture the actual head's hardware before Open replaces its job.
      previousCncParams:
        (previous.machine?.kind === 'cnc' ? previous.machine : previous.parkedCncMachine)?.params ??
        previous.device.cncSubProfile,
      openedDeviceName: project.device.name,
      previousDeviceName: previous.device.name,
      openedWorkspace,
      openedBed,
      workspaceMismatch,
      machineChanged,
      bedSizeOnly: machineChanged && sameProfile(project.device, previous.device),
      camera: machineChanged ? cameraCalibrationChange(project.device, previous.device) : null,
    },
  };
}

function sameProfile(a: DeviceProfile, b: DeviceProfile): boolean {
  return (a.profileId ?? '') === (b.profileId ?? '') && a.name === b.name;
}

// A file for another machine brings its calibration (ADR-440 Amendment 3
// Decision 4), so the notice names the swap when there is one.
function cameraCalibrationChange(
  opened: DeviceProfile,
  current: DeviceProfile,
): CameraCalibrationChange | null {
  if (!hasCameraCalibration(opened) && !hasCameraCalibration(current)) return null;
  if (sameValue(cameraFields(opened), cameraFields(current))) return null;
  return {
    openedCalibratedAt: opened.cameraModel?.calibratedAt ?? null,
    currentCalibratedAt: current.cameraModel?.calibratedAt ?? null,
  };
}

/**
 * A file opened for the machine already in use keeps that machine's own
 * Auto-focus command (ADR-400 Amendment 1). The file can copy the machine's
 * identity, and then no machine notice shows, so its line must not decide what
 * the next Auto-focus press sends. A file for another machine brings its
 * vetted command with the rest of that machine, behind the machine notice.
 */
export function withCurrentMachineAutofocus(
  project: Project,
  previous: Project,
): { readonly project: Project; readonly keptCurrentCommand: boolean } {
  const current = previous.device.autofocusCommand;
  if (
    project.device.autofocusCommand === current ||
    deviceIdentity(project.device) !== deviceIdentity(previous.device)
  )
    return { project, keptCurrentCommand: false };
  return {
    project: { ...project, device: { ...project.device, autofocusCommand: current } },
    keptCurrentCommand: true,
  };
}

/**
 * A file opened for the machine already in use keeps that machine's camera
 * calibrations (ADR-440 Amendment 3). The camera belongs to the machine, not
 * the job: a file saved before the latest calibration must not swap in its
 * older copy, or none, and then have the next machine edit save that over the
 * calibration. With no calibration in use the file's copy comes in as before;
 * a file for another machine brings its own, behind the machine notice.
 */
export function withCurrentMachineCamera(
  project: Project,
  previous: Project,
): { readonly project: Project; readonly keptCurrentCamera: boolean } {
  const current = previous.device;
  if (!hasCameraCalibration(current) || deviceIdentity(project.device) !== deviceIdentity(current))
    return { project, keptCurrentCamera: false };
  const opened = project.device;
  const { cameraModel: _model, otherCameraModels: _others, ...rest } = opened;
  return {
    project: { ...project, device: { ...rest, ...cameraFields(current) } },
    // Worth a word only when the file held a calibration of its own.
    keptCurrentCamera:
      hasCameraCalibration(opened) && !sameValue(cameraFields(opened), cameraFields(current)),
  };
}

// Structural equality for saved JSON-like records: a file's copy of the same
// calibration is a different object with the same values.
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null)
    return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return (
    keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length &&
    keys.every((key) => sameValue(a[key], b[key]))
  );
}

function hasCameraCalibration(device: DeviceProfile): boolean {
  return device.cameraModel !== undefined || (device.otherCameraModels?.length ?? 0) > 0;
}

function cameraFields(
  device: DeviceProfile,
): Pick<DeviceProfile, 'cameraModel' | 'otherCameraModels'> {
  return {
    ...(device.cameraModel === undefined ? {} : { cameraModel: device.cameraModel }),
    ...(device.otherCameraModels === undefined
      ? {}
      : { otherCameraModels: device.otherCameraModels }),
  };
}

function deviceIdentity(device: DeviceProfile): string {
  return [device.profileId ?? '', device.name, device.bedWidth, device.bedHeight].join('|');
}
