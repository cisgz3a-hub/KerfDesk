// fresh-operation-seeding — the one way a new operation takes the operator's
// setup, whatever added its artwork: the saved Make Default first, then the
// CNC stock material or machine starter (ADR-112, ADR-416 decision 2), or on a
// laser the job material's best recipe (ADR-496 decision 4). Drawing, text,
// SVG import, box panels, barcodes, Design Studio, dimensioned parts and AI
// drafts all seed here, so no add path drifts from the others.

import { machineKindOf, type Layer, type Project, type SceneObject } from '../../core/scene';
import type { MaterialLibraryDocument } from '../../io/material-library';
import { applyLayerDefaultSettings } from '../layers/layer-default-settings';
import { seedFreshCncLayer } from './cnc-auto-seeding';
import type { CncLiveCapsState } from './cnc-live-caps-actions';
import { seedFreshLaserLayer } from './laser-recipe-seeding';
import { defaultSettingsForOperation, type LayerDefaultsState } from './layer-default-actions';

export type FreshOperationSources = {
  readonly defaults: LayerDefaultsState;
  readonly liveCaps: CncLiveCapsState['cncLiveCaps'];
  readonly materialLibrary: MaterialLibraryDocument | null;
};

/** A new operation with Make Default and the material or machine seeding applied. */
export function seedFreshOperation(
  operation: Layer,
  project: Project,
  objects: ReadonlyArray<SceneObject>,
  sources: FreshOperationSources,
): Layer {
  const settings = defaultSettingsForOperation(sources.defaults, objects, operation);
  const withDefaults =
    Object.keys(settings).length === 0
      ? operation
      : applyLayerDefaultSettings(operation, settings, machineKindOf(project.machine));
  // Each seeding is a no-op when no material (or, on CNC, no starter) applies.
  const machine = project.machine;
  return machine?.kind === 'cnc'
    ? seedFreshCncLayer(withDefaults, {
        device: project.device,
        machine,
        liveCaps: sources.liveCaps,
      })
    : seedFreshLaserLayer(withDefaults, project, sources.materialLibrary);
}

/** Every layer not in `previousLayers` seeded as above. */
export function applyLayerDefaultsToFreshLayers<T extends { readonly project: Project }>(
  previousLayers: ReadonlyArray<Layer>,
  result: T,
  defaults: LayerDefaultsState,
  liveCaps: CncLiveCapsState['cncLiveCaps'],
  materialLibrary: MaterialLibraryDocument | null,
): T {
  const existing = new Set(previousLayers.map((layer) => layer.id));
  const sources = { defaults, liveCaps, materialLibrary };
  let changed = false;
  const layers = result.project.scene.layers.map((layer) => {
    if (existing.has(layer.id)) return layer;
    const seeded = seedFreshOperation(layer, result.project, result.project.scene.objects, sources);
    if (seeded !== layer) changed = true;
    return seeded;
  });
  if (!changed) return result;
  return {
    ...result,
    project: {
      ...result.project,
      scene: { ...result.project.scene, layers },
    },
  };
}

// Authored SVG fill/stroke and decoded image density determine structural
// settings. Saved speed/power/CNC preferences must not turn an image into Line.
export function svgStructuralDefaults(defaults: LayerDefaultsState): LayerDefaultsState {
  const settings = (value: NonNullable<LayerDefaultsState['allColors']>) => {
    const { mode: _mode, linesPerMm: _density, ...rest } = value;
    return rest;
  };
  return {
    ...defaults,
    allColors: defaults.allColors === null ? null : settings(defaults.allColors),
    byColor: Object.fromEntries(
      Object.entries(defaults.byColor).map(([key, value]) => [key, settings(value)]),
    ),
  };
}
