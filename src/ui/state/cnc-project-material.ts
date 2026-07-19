// cnc-project-material — pure helpers for the project-level CNC material
// (ADR-112, Easel's "set material once for the job"). One place computes a
// layer's feeds from a material so the picker's bulk apply and the new-layer
// seeding hooks stay in lockstep. No store access — callers thread the project.

import { isChiploadMaterialKey } from '../../core/cnc';
import {
  DEFAULT_ASSUMED_FLUTE_COUNT,
  resolveCncMaterialFeedPatch,
  type CncMachineStarterLiveCaps,
} from '../../core/cnc/machine-starters';
import type { DeviceProfile } from '../../core/devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncStock,
  type CncTool,
  type Layer,
  type Project,
} from '../../core/scene';

// `layer` with its feeds auto-filled from `materialKey`, using the layer's own
// bit and spindle. Everything else on the layer is preserved; an unknown key is
// a no-op (returns the same layer).
export function layerWithCncMaterial(input: {
  readonly layer: Layer;
  readonly machine: CncMachineConfig;
  readonly profile: DeviceProfile;
  readonly materialKey: string;
  readonly liveCaps?: CncMachineStarterLiveCaps | null;
  readonly fluteCount?: number;
}): Layer {
  const cnc = input.layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const patch = materialFeedsPatch({
    materialKey: input.materialKey,
    tool: layerCncTool(input.machine, cnc),
    spindleRpm: cnc.spindleRpm,
    profile: input.profile,
    machineSpindleMaxRpm: input.machine.params.spindleMaxRpm,
    ...(input.liveCaps === undefined ? {} : { liveCaps: input.liveCaps }),
    ...(input.fluteCount === undefined ? {} : { fluteCount: input.fluteCount }),
  });
  if (patch === null) return input.layer;
  return { ...input.layer, cnc: { ...cnc, ...patch } };
}

// Material-derived feeds for a specific bit — the single source the material
// pickers AND bit changes use, so swapping bits can never leave stale
// material feeds behind. Null for unknown material keys.
export function materialFeedsPatch(input: {
  readonly materialKey: string;
  readonly tool: CncTool;
  readonly spindleRpm: number;
  readonly profile: DeviceProfile;
  readonly machineSpindleMaxRpm: number;
  readonly liveCaps?: CncMachineStarterLiveCaps | null;
  readonly fluteCount?: number;
}): Partial<CncLayerSettings> | null {
  return resolveCncMaterialFeedPatch({
    profile: input.profile,
    tool: input.tool,
    materialKey: input.materialKey,
    spindleRpm: input.spindleRpm,
    machineSpindleMaxRpm: input.machineSpindleMaxRpm,
    fluteCount: input.fluteCount ?? DEFAULT_ASSUMED_FLUTE_COUNT,
    ...(input.liveCaps === null || input.liveCaps === undefined
      ? {}
      : { liveCaps: input.liveCaps }),
  });
}

// Set (or clear, when null) the project stock material and auto-fill every
// layer's feeds from it. Clearing drops only the project association — layers
// keep their current feeds, mirroring the per-layer "Custom". No-op (same
// reference) for a laser project.
export function projectWithStockMaterial(
  project: Project,
  materialKey: string | null,
  liveCaps?: CncMachineStarterLiveCaps | null,
): Project {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') return project;
  if (materialKey !== null && !isChiploadMaterialKey(materialKey)) return project;
  const stock =
    materialKey === null ? stockWithoutMaterial(machine.stock) : { ...machine.stock, materialKey };
  const layers =
    materialKey === null
      ? project.scene.layers
      : project.scene.layers.map((layer) =>
          layerWithCncMaterial({
            layer,
            machine,
            profile: project.device,
            materialKey,
            ...(liveCaps === undefined ? {} : { liveCaps }),
          }),
        );
  return {
    ...project,
    machine: { ...machine, stock },
    scene: { ...project.scene, layers },
  };
}

// Seed a freshly-created CNC layer from the project stock material (new-layer
// hooks call this). No project material, or laser mode, leaves the layer as-is.
export function seedLayerFromStockMaterial(
  layer: Layer,
  machine: CncMachineConfig,
  profile: DeviceProfile,
  liveCaps?: CncMachineStarterLiveCaps | null,
): Layer {
  const materialKey = machine.stock.materialKey;
  return materialKey === undefined
    ? layer
    : layerWithCncMaterial({
        layer,
        machine,
        profile,
        materialKey,
        ...(liveCaps === undefined ? {} : { liveCaps }),
      });
}

function stockWithoutMaterial(stock: CncStock): CncStock {
  const { materialKey: _dropped, ...rest } = stock;
  return rest;
}
