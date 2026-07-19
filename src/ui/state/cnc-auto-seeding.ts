import {
  resolveCncAutoLayerSettings,
  resolveCncMaterialFeedPatch,
  resolveCncStarterFeedPatch,
  type CncMachineStarterLiveCaps,
} from '../../core/cnc/machine-starters';
import {
  isRegistrationLayer,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type Layer,
  type Project,
  type Scene,
} from '../../core/scene';
import type { DeviceProfile } from '../../core/devices';

export type CncAutoSeedContext = {
  readonly device: DeviceProfile;
  readonly machine: CncMachineConfig;
  readonly liveCaps: CncMachineStarterLiveCaps | null;
};

// Call only for an operation proven fresh by its mutation boundary. Existing
// settings are used as a structural base (for example CNC text's cut type),
// while automatic feed fields and provenance come from one resolver.
export function seedFreshCncLayer(layer: Layer, context: CncAutoSeedContext): Layer {
  if (isRegistrationLayer(layer)) return layer;
  const settings = resolveCncAutoLayerSettings({
    profile: context.device,
    machine: context.machine,
    ...(layer.cnc === undefined ? {} : { baseSettings: layer.cnc }),
    ...(context.liveCaps === null ? {} : { liveCaps: context.liveCaps }),
  });
  return settings === null ? layer : { ...layer, cnc: settings };
}

export function projectWithFreshCncLayers(
  previousLayers: ReadonlyArray<Layer>,
  project: Project,
  liveCaps: CncMachineStarterLiveCaps | null,
  savedDefaultLayerIds: ReadonlySet<string> = new Set(),
): Project {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return project;
  const existingIds = new Set(previousLayers.map((layer) => layer.id));
  let changed = false;
  const layers = project.scene.layers.map((layer) => {
    if (existingIds.has(layer.id) || savedDefaultLayerIds.has(layer.id)) return layer;
    const seeded = seedFreshCncLayer(layer, { device: project.device, machine, liveCaps });
    if (seeded !== layer) changed = true;
    return seeded;
  });
  return changed ? { ...project, scene: { ...project.scene, layers } } : project;
}

export function refreshAutomaticCncFeeds(scene: Scene, context: CncAutoSeedContext): Scene {
  const layers = scene.layers.map((layer) => refreshAutomaticCncLayer(layer, context));
  const changed = layers.some((layer, index) => layer !== scene.layers[index]);
  return changed ? { ...scene, layers } : scene;
}

function refreshAutomaticCncLayer(layer: Layer, context: CncAutoSeedContext): Layer {
  const settings = layer.cnc;
  const source = settings?.feedSource;
  if (settings === undefined || source === undefined) return layer;
  return source.kind === 'machine-starter'
    ? refreshMachineStarterLayer(layer, settings, source, context)
    : refreshMaterialRecipeLayer(layer, settings, source, context);
}

function refreshMachineStarterLayer(
  layer: Layer,
  settings: CncLayerSettings,
  source: Extract<NonNullable<CncLayerSettings['feedSource']>, { kind: 'machine-starter' }>,
  context: CncAutoSeedContext,
): Layer {
  const patch = resolveCncStarterFeedPatch(
    context.liveCaps === null
      ? { profile: context.device, machine: context.machine }
      : { profile: context.device, machine: context.machine, liveCaps: context.liveCaps },
  );
  const resolvedSource = patch?.feedSource;
  if (
    patch !== null &&
    resolvedSource?.kind === 'machine-starter' &&
    resolvedSource.starterId === source.starterId &&
    source.revision <= resolvedSource.revision
  ) {
    return layerWithAutomaticPatch(layer, settings, patch);
  }
  // Keep the exact numeric settings, but withdraw automatic rewrite authority
  // for an unknown/newer starter or a different profile's starter. A future
  // catalog must never downgrade newer persisted data.
  const { feedSource: _source, ...withoutSource } = settings;
  return { ...layer, cnc: withoutSource };
}

function refreshMaterialRecipeLayer(
  layer: Layer,
  settings: CncLayerSettings,
  source: Extract<NonNullable<CncLayerSettings['feedSource']>, { kind: 'material-recipe' }>,
  context: CncAutoSeedContext,
): Layer {
  const patch = resolveCncMaterialFeedPatch({
    profile: context.device,
    tool: layerCncTool(context.machine, settings),
    materialKey: source.materialKey,
    spindleRpm: settings.spindleRpm,
    machineSpindleMaxRpm: context.machine.params.spindleMaxRpm,
    fluteCount: source.fluteCount,
    ...(context.liveCaps === null ? {} : { liveCaps: context.liveCaps }),
  });
  return patch === null ? layer : layerWithAutomaticPatch(layer, settings, patch);
}

function layerWithAutomaticPatch(
  layer: Layer,
  settings: CncLayerSettings,
  patch: Partial<CncLayerSettings>,
): Layer {
  const next = { ...settings, ...patch };
  return automaticFeedFieldsEqual(settings, next) ? layer : { ...layer, cnc: next };
}

export function refreshAutomaticCncFeedsAfterToolRemoval(
  scene: Scene,
  context: CncAutoSeedContext,
  removedToolId: string,
): Scene {
  let changed = false;
  const layers = scene.layers.map((layer) => {
    const settings = layer.cnc;
    if (settings?.feedSource?.kind !== 'material-recipe' || settings.toolId !== removedToolId) {
      return layer;
    }
    const { toolId: _removed, ...withoutRemovedTool } = settings;
    changed = true;
    return { ...layer, cnc: withoutRemovedTool };
  });
  const prepared = changed ? { ...scene, layers } : scene;
  return refreshAutomaticCncFeeds(prepared, context);
}

function automaticFeedFieldsEqual(left: CncLayerSettings, right: CncLayerSettings): boolean {
  return (
    left.toolId === right.toolId &&
    left.depthPerPassMm === right.depthPerPassMm &&
    left.feedMmPerMin === right.feedMmPerMin &&
    left.plungeMmPerMin === right.plungeMmPerMin &&
    left.spindleRpm === right.spindleRpm &&
    JSON.stringify(left.feedSource) === JSON.stringify(right.feedSource)
  );
}

// Laser -> CNC is an explicit operator conversion, so operations that had no
// CNC block beforehand may be initialized. Existing automatic settings follow
// the selected machine; manual/legacy blocks remain untouched.
export function seedCncModeSwitchLayers(
  before: Scene,
  prepared: Scene,
  context: CncAutoSeedContext,
): Scene {
  const unconfiguredIds = new Set(
    before.layers.filter((layer) => layer.cnc === undefined).map((layer) => layer.id),
  );
  const refreshed = refreshAutomaticCncFeeds(prepared, context);
  let changed = refreshed !== prepared;
  const layers = refreshed.layers.map((layer) => {
    if (!unconfiguredIds.has(layer.id)) return layer;
    const seeded = seedFreshCncLayer(layer, context);
    if (seeded !== layer) changed = true;
    return seeded;
  });
  return changed ? { ...refreshed, layers } : refreshed;
}
