import { cncMaxFeedMmPerMin } from '../../core/cnc/cnc-head-feeds';
import type { CncMachineStarterLiveCaps } from '../../core/cnc/machine-starters';
import type { DeviceProfile } from '../../core/devices';
import type { CncMachineParams, MachineConfig, Project, Scene } from '../../core/scene';
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
  return {
    ...project,
    scene,
    device: nextProfile,
    workspace: {
      ...project.workspace,
      width: nextProfile.bedWidth,
      height: nextProfile.bedHeight,
    },
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
