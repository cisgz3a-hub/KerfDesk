import {
  createArtworkOperation,
  fitObjectToBed,
  type ImportedSvg,
  type Layer,
  type Project,
} from '../../core/scene';
import type { AppState } from './store';
import { seedFreshCncLayer } from './cnc-auto-seeding';
import { seedFreshLaserLayer } from './laser-recipe-seeding';
import { defaultSettingsForOperation } from './layer-default-actions';
import { applyLayerDefaultSettings } from '../layers/layer-default-settings';
/** Stage dimensioned artwork at its authored size, using ordinary operation defaults. */
export function prepareDimensionedVector(
  state: AppState,
  source: ImportedSvg,
): { readonly object: ImportedSvg; readonly project: Project } {
  const created = createArtworkOperation(state.project.scene, source, { mode: 'line' });
  const object = fitObjectToBed(
    created.object,
    state.project.device.bedWidth,
    state.project.device.bedHeight,
    'center-only',
  ) as ImportedSvg;
  const scene = {
    ...state.project.scene,
    objects: [...state.project.scene.objects, object],
    layers: [...state.project.scene.layers, seedOperation(state, created.operation, object)],
  };
  return { object, project: { ...state.project, scene } };
}
function seedOperation(state: AppState, operation: Layer, object: ImportedSvg): Layer {
  const settings = defaultSettingsForOperation(state.layerDefaults, [object], operation);
  const layer =
    Object.keys(settings).length === 0
      ? operation
      : applyLayerDefaultSettings(operation, settings, state.project.machine?.kind ?? 'laser');
  const machine = state.project.machine;
  return machine?.kind === 'cnc'
    ? seedFreshCncLayer(layer, {
        device: state.project.device,
        machine,
        liveCaps: state.cncLiveCaps,
      })
    : seedFreshLaserLayer(layer, state.project, state.materialLibrary);
}
