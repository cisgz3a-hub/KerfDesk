import type { JobPlacementSettings } from '../../core/job';
import type { Layer, MachineKind, Project } from '../../core/scene';
import { defaultJobPlacementForDevice } from '../job-placement';

// Laser and CNC keep their own job placement and Output switches (ADR-416).
// What the rest of the app reads (`jobSetup.placement`, `layer.output`) always
// holds the active mode's value. The other mode's value waits in
// `jobSetup.parkedPlacement` and `layer.parkedOutput`, and the two change
// places on every switch. A first switch has nothing parked, so the new mode
// starts from the current values; from then on each mode keeps its own.
export function projectForModeSwitch(
  project: Project,
  from: MachineKind,
  to: MachineKind,
): Project {
  if (from === to) return project;
  const { placement, parkedPlacement } = project.jobSetup;
  const restored = parkedPlacement ?? placement;
  return {
    ...project,
    jobSetup: {
      ...project.jobSetup,
      placement: placementForDevice(restored, project.device),
      parkedPlacement: placement,
    },
    scene: sceneForModeSwitch(project.scene),
  };
}

// The store's `jobPlacement` is the live placement; it is written onto the
// project before the swap and read back from it after.
export function modeSwitchState(
  project: Project,
  jobPlacement: JobPlacementSettings,
  from: MachineKind,
  to: MachineKind,
): { readonly project: Project; readonly jobPlacement: JobPlacementSettings } {
  if (from === to) return { project, jobPlacement };
  const live = { ...project, jobSetup: { ...project.jobSetup, placement: jobPlacement } };
  const switched = projectForModeSwitch(live, from, to);
  return { project: switched, jobPlacement: switched.jobSetup.placement };
}

// A scene whose switches already match in both modes is returned unchanged.
function sceneForModeSwitch(scene: Project['scene']): Project['scene'] {
  const layers = scene.layers.map(layerForModeSwitch);
  return layers.every((layer, index) => layer === scene.layers[index])
    ? scene
    : { ...scene, layers };
}

function layerForModeSwitch(layer: Layer): Layer {
  if (layer.parkedOutput === layer.output) return layer;
  return { ...layer, output: layer.parkedOutput ?? layer.output, parkedOutput: layer.output };
}

// A placement parked before Machine Setup turned homing off cannot come back
// as Absolute; it takes the machine's default, as a profile change would.
function placementForDevice(
  placement: JobPlacementSettings,
  device: Project['device'],
): JobPlacementSettings {
  if (placement.startFrom !== 'absolute' || device.homing.enabled) return placement;
  return { ...placement, startFrom: defaultJobPlacementForDevice(device).startFrom };
}
