// cnc-project-material — pure helpers for the project-level CNC material
// (ADR-112, Easel's "set material once for the job"). One place computes a
// layer's feeds from a material so the picker's bulk apply and the new-layer
// seeding hooks stay in lockstep. No store access — callers thread the project.

import { calculateFeeds, isChiploadMaterialKey } from '../../core/cnc';
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

// One-click project/seed fill assumes a 2-flute bit, matching the per-layer
// Material picker (ADR-111 #1). Precise flute/RPM control stays in the Feeds
// calculator.
const ASSUMED_FLUTES = 2;

// `layer` with its feeds auto-filled from `materialKey`, using the layer's own
// bit and spindle. Everything else on the layer is preserved; an unknown key is
// a no-op (returns the same layer).
export function layerWithCncMaterial(
  layer: Layer,
  machine: CncMachineConfig,
  materialKey: string,
  maxFeedMmPerMin?: number,
): Layer {
  const cnc = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const patch = materialFeedsPatch(
    materialKey,
    layerCncTool(machine, cnc),
    cnc.spindleRpm,
    maxFeedMmPerMin,
  );
  if (patch === null) return layer;
  return { ...layer, cnc: { ...cnc, ...patch } };
}

// Material-derived feeds for a specific bit — the single source the material
// pickers AND bit changes use, so swapping bits can never leave stale
// material feeds behind. Null for unknown material keys.
export function materialFeedsPatch(
  materialKey: string,
  tool: CncTool,
  spindleRpm: number,
  maxFeedMmPerMin?: number,
): Partial<CncLayerSettings> | null {
  if (!isChiploadMaterialKey(materialKey)) return null;
  const feeds = calculateFeeds({
    material: materialKey,
    bitDiameterMm: tool.diameterMm,
    flutes: ASSUMED_FLUTES,
    rpm: spindleRpm,
    ...(maxFeedMmPerMin === undefined ? {} : { maxFeedMmPerMin }),
  });
  if (feeds.kind === 'error') return null;
  return {
    materialKey,
    feedMmPerMin: feeds.feedMmPerMin,
    plungeMmPerMin: feeds.plungeMmPerMin,
    depthPerPassMm: feeds.depthPerPassMm,
  };
}

// Set (or clear, when null) the project stock material and auto-fill every
// layer's feeds from it. Clearing drops only the project association — layers
// keep their current feeds, mirroring the per-layer "Custom". No-op (same
// reference) for a laser project.
export function projectWithStockMaterial(project: Project, materialKey: string | null): Project {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') return project;
  if (materialKey !== null && !isChiploadMaterialKey(materialKey)) return project;
  const stock =
    materialKey === null ? stockWithoutMaterial(machine.stock) : { ...machine.stock, materialKey };
  const layers =
    materialKey === null
      ? project.scene.layers
      : project.scene.layers.map((layer) =>
          layerWithCncMaterial(layer, machine, materialKey, project.device.maxFeed),
        );
  return {
    ...project,
    machine: { ...machine, stock },
    scene: { ...project.scene, layers },
  };
}

// Seed a freshly-created CNC layer from the project stock material (new-layer
// hooks call this). No project material, or laser mode, leaves the layer as-is.
export function seedLayerFromStockMaterial(layer: Layer, machine: CncMachineConfig): Layer {
  const materialKey = machine.stock.materialKey;
  return materialKey === undefined ? layer : layerWithCncMaterial(layer, machine, materialKey);
}

function stockWithoutMaterial(stock: CncStock): CncStock {
  const { materialKey: _dropped, ...rest } = stock;
  return rest;
}
