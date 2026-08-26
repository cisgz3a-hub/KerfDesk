import type { CncMachineStarterLiveCaps } from '../../core/cnc/machine-starters';
import type { DeviceProfile } from '../../core/devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type Layer,
  type Scene,
} from '../../core/scene';
import { withoutCncFeedProvenance, withoutCncFeedSource } from './cnc-feed-provenance';
import { materialFeedsPatch } from './cnc-project-material';

// Setup-owned CNC bindings for one operation. Null is explicit: it means the
// operation follows the job default (tool) or uses manual feeds (material).
// The cutting values remain on the Layer and are not part of this draft.
export type CncStartupOperationDraft = {
  readonly layerId: string;
  readonly materialKey: string | null;
  readonly toolId: string | null;
  readonly vClearToolId: string | null;
  readonly pocketRoughToolId: string | null;
  readonly reliefFinishToolId: string | null;
};

export function cncStartupOperationDraft(layer: Layer): CncStartupOperationDraft {
  const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  return {
    layerId: layer.id,
    materialKey: settings.materialKey ?? null,
    toolId: settings.toolId ?? null,
    vClearToolId: settings.vClearToolId ?? null,
    pocketRoughToolId: settings.pocketRoughToolId ?? null,
    reliefFinishToolId: settings.reliefFinishToolId ?? null,
  };
}

export function sceneWithCncStartupOperationDrafts(input: {
  readonly scene: Scene;
  readonly machine: CncMachineConfig;
  readonly profile: DeviceProfile;
  readonly liveCaps: CncMachineStarterLiveCaps | null;
  readonly drafts: ReadonlyArray<CncStartupOperationDraft>;
}): Scene {
  if (input.drafts.length === 0) return input.scene;
  const drafts = new Map(input.drafts.map((draft) => [draft.layerId, draft]));
  let changed = false;
  const layers = input.scene.layers.map((layer) => {
    const draft = drafts.get(layer.id);
    if (draft === undefined) return layer;
    const next = layerWithCncStartupOperationDraft(layer, draft, input);
    if (next !== layer) changed = true;
    return next;
  });
  return changed ? { ...input.scene, layers } : input.scene;
}

function layerWithCncStartupOperationDraft(
  layer: Layer,
  draft: CncStartupOperationDraft,
  context: {
    readonly machine: CncMachineConfig;
    readonly profile: DeviceProfile;
    readonly liveCaps: CncMachineStarterLiveCaps | null;
  },
): Layer {
  const current = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  if (operationDraftMatches(current, draft)) return layer;

  const primaryChanged = (current.toolId ?? null) !== draft.toolId;
  const materialChanged = (current.materialKey ?? null) !== draft.materialKey;
  let settings = settingsWithToolBindings(current, draft);

  if (materialChanged) {
    settings = settingsWithMaterialBinding(settings, draft.materialKey, context);
  } else if (primaryChanged) {
    settings = settingsAfterPrimaryToolChange(current, settings, context);
  }

  return { ...layer, cnc: settings };
}

function settingsAfterPrimaryToolChange(
  previous: CncLayerSettings,
  settings: CncLayerSettings,
  context: {
    readonly machine: CncMachineConfig;
    readonly profile: DeviceProfile;
    readonly liveCaps: CncMachineStarterLiveCaps | null;
  },
): CncLayerSettings {
  const source = previous.feedSource;
  if (source?.kind !== 'material-recipe') return withoutCncFeedSource(settings);
  const tool = layerCncTool(context.machine, settings);
  const patch = materialFeedsPatch({
    materialKey: source.materialKey,
    tool,
    spindleRpm: settings.spindleRpm,
    profile: context.profile,
    machineSpindleMaxRpm: context.machine.params.spindleMaxRpm,
    liveCaps: context.liveCaps,
    fluteCount: tool.fluteCount ?? source.fluteCount,
  });
  return patch === null ? withoutCncFeedSource(settings) : { ...settings, ...patch };
}

function settingsWithToolBindings(
  settings: CncLayerSettings,
  draft: CncStartupOperationDraft,
): CncLayerSettings {
  const {
    toolId: _toolId,
    vClearToolId: _vClearToolId,
    pocketRoughToolId: _pocketRoughToolId,
    reliefFinishToolId: _reliefFinishToolId,
    ...rest
  } = settings;
  return {
    ...rest,
    ...(draft.toolId === null ? {} : { toolId: draft.toolId }),
    ...(draft.vClearToolId === null ? {} : { vClearToolId: draft.vClearToolId }),
    ...(draft.pocketRoughToolId === null ? {} : { pocketRoughToolId: draft.pocketRoughToolId }),
    ...(draft.reliefFinishToolId === null ? {} : { reliefFinishToolId: draft.reliefFinishToolId }),
  };
}

function settingsWithMaterialBinding(
  settings: CncLayerSettings,
  materialKey: string | null,
  context: {
    readonly machine: CncMachineConfig;
    readonly profile: DeviceProfile;
    readonly liveCaps: CncMachineStarterLiveCaps | null;
  },
): CncLayerSettings {
  if (materialKey === null) return withoutCncFeedProvenance(settings);
  const tool = layerCncTool(context.machine, settings);
  const patch = materialFeedsPatch({
    materialKey,
    tool,
    spindleRpm: settings.spindleRpm,
    profile: context.profile,
    machineSpindleMaxRpm: context.machine.params.spindleMaxRpm,
    liveCaps: context.liveCaps,
  });
  return patch === null
    ? { ...withoutCncFeedSource(settings), materialKey }
    : { ...settings, ...patch };
}

function operationDraftMatches(
  settings: CncLayerSettings,
  draft: CncStartupOperationDraft,
): boolean {
  return (
    (settings.materialKey ?? null) === draft.materialKey &&
    (settings.toolId ?? null) === draft.toolId &&
    (settings.vClearToolId ?? null) === draft.vClearToolId &&
    (settings.pocketRoughToolId ?? null) === draft.pocketRoughToolId &&
    (settings.reliefFinishToolId ?? null) === draft.reliefFinishToolId
  );
}
