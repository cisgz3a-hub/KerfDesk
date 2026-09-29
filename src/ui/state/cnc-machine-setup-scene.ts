import { cncMachineWithOwnFeeds, cncMaxFeedMmPerMin } from '../../core/cnc/cnc-head-feeds';
import type { CncMachineStarterLiveCaps } from '../../core/cnc/machine-starters';
import type { DeviceProfile } from '../../core/devices';
import type {
  CncMachineConfig,
  CncMachineParams,
  MachineConfig,
  Project,
  Scene,
} from '../../core/scene';
import { refreshAutomaticCncFeeds, seedCncModeSwitchLayers } from './cnc-auto-seeding';
import { applyCncTextDefaultsForScene } from './cnc-text-defaults';

export function sceneAfterMachineSetup(
  scene: Scene,
  previousMachine: MachineConfig | undefined,
  profile: DeviceProfile,
  machine: MachineConfig,
  liveCaps: CncMachineStarterLiveCaps | null,
): Scene {
  if (machine.kind !== 'cnc') return scene;
  const context = { device: profile, machine, liveCaps };
  if (previousMachine?.kind !== 'cnc') {
    const prepared = applyCncTextDefaultsForScene(scene, machine);
    return seedCncModeSwitchLayers(scene, prepared, context);
  }
  return refreshAutomaticCncFeeds(scene, {
    ...context,
    activeToolChanged: previousMachine.toolId !== machine.toolId,
    fluteCountChangedToolIds: changedFluteCountToolIds(previousMachine, machine),
  });
}

function changedFluteCountToolIds(
  previous: Extract<MachineConfig, { readonly kind: 'cnc' }>,
  next: Extract<MachineConfig, { readonly kind: 'cnc' }>,
): ReadonlySet<string> {
  const previousTools = new Map(previous.tools.map((tool) => [tool.id, tool]));
  return new Set(
    next.tools
      .filter((tool) => {
        const previousTool = previousTools.get(tool.id);
        return previousTool === undefined || previousTool.fluteCount !== tool.fluteCount;
      })
      .map((tool) => tool.id),
  );
}

export function sceneAfterDeviceProfileChange(
  scene: Scene,
  previousProfile: DeviceProfile,
  nextProfile: DeviceProfile,
  machine: MachineConfig | undefined,
  liveCaps: CncMachineStarterLiveCaps | null,
): Scene {
  if (
    machine?.kind !== 'cnc' ||
    !cncAutomaticInputsChanged(previousProfile, nextProfile, machine.params)
  ) {
    return scene;
  }
  return refreshAutomaticCncFeeds(scene, {
    device: nextProfile,
    machine,
    liveCaps,
  });
}

export function projectAfterDeviceProfileChange(
  project: Project,
  nextProfile: DeviceProfile,
  liveCaps: CncMachineStarterLiveCaps | null,
): Project {
  const scene = sceneAfterDeviceProfileChange(
    project.scene,
    project.device,
    nextProfile,
    project.machine,
    liveCaps,
  );
  return projectWithProfile(project, scene, nextProfile);
}

// Replacing the whole profile (ADR-500 "Use <last machine>", a machine-profile
// import) picks another machine. Machine Setup saves its router values on the
// profile, so they replace the safe Z, spindle, feeds and park of the CNC
// machine that compiles the job, and of the cached one the next Laser/CNC
// switch restores. Keeping the old params ran the saved machine's jobs at the
// generic 3.81 mm safe Z. A profile without CNC values leaves them as they are.
export function cncMachineForProfile(
  machine: CncMachineConfig,
  profile: DeviceProfile,
): CncMachineConfig {
  const params = profile.cncSubProfile;
  if (params === undefined) return machine;
  return cncMachineWithOwnFeeds({ ...machine, params: { ...params } }, profile);
}

export function projectAfterDeviceProfileReplacement(
  project: Project,
  nextProfile: DeviceProfile,
  liveCaps: CncMachineStarterLiveCaps | null,
): Project {
  const machine = project.machine;
  if (machine?.kind !== 'cnc' || nextProfile.cncSubProfile === undefined) {
    return projectAfterDeviceProfileChange(project, nextProfile, liveCaps);
  }
  const nextMachine = cncMachineForProfile(machine, nextProfile);
  const scene = refreshAutomaticCncFeeds(project.scene, {
    device: nextProfile,
    machine: nextMachine,
    liveCaps,
  });
  return { ...projectWithProfile(project, scene, nextProfile), machine: nextMachine };
}

function projectWithProfile(project: Project, scene: Scene, profile: DeviceProfile): Project {
  return {
    ...project,
    scene,
    device: profile,
    workspace: { ...project.workspace, width: profile.bedWidth, height: profile.bedHeight },
  };
}

// CNC's own Max feed is on its params, so a laser Max feed edit changes
// nothing here unless an older CNC setup still falls back to the device value.
function cncAutomaticInputsChanged(
  previous: DeviceProfile,
  next: DeviceProfile,
  params: CncMachineParams,
): boolean {
  return (
    previous.profileId !== next.profileId ||
    previous.machineFamily !== next.machineFamily ||
    cncMaxFeedMmPerMin(previous, params) !== cncMaxFeedMmPerMin(next, params) ||
    previous.cncSubProfile?.spindleMaxRpm !== next.cncSubProfile?.spindleMaxRpm
  );
}
