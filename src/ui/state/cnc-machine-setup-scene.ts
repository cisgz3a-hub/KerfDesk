import type { CncMachineStarterLiveCaps } from '../../core/cnc/machine-starters';
import type { DeviceProfile } from '../../core/devices';
import type { MachineConfig, Project, Scene } from '../../core/scene';
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
  if (machine?.kind !== 'cnc' || !cncAutomaticInputsChanged(previousProfile, nextProfile)) {
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

function cncAutomaticInputsChanged(previous: DeviceProfile, next: DeviceProfile): boolean {
  return (
    previous.profileId !== next.profileId ||
    previous.machineFamily !== next.machineFamily ||
    previous.maxFeed !== next.maxFeed ||
    previous.cncSubProfile?.spindleMaxRpm !== next.cncSubProfile?.spindleMaxRpm
  );
}
