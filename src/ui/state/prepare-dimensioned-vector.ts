import {
  createArtworkOperation,
  fitObjectToBed,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import type { AppState } from './store';
import { seedFreshOperation } from './fresh-operation-seeding';
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
  const operation = seedFreshOperation(created.operation, state.project, [object], {
    defaults: state.layerDefaults,
    liveCaps: state.cncLiveCaps,
    materialLibrary: state.materialLibrary,
  });
  const scene = {
    ...state.project.scene,
    objects: [...state.project.scene.objects, object],
    layers: [...state.project.scene.layers, operation],
  };
  return { object, project: { ...state.project, scene } };
}
