import {
  addLayer,
  artworkOperationName,
  assertNever,
  bindSceneObjectToOperations,
  createArtworkOperation,
  operationIdsForObject,
  sceneObjectUsesOperation,
  updateLayer,
  type Project,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { applyLayerDefaultSettings } from '../layers/layer-default-settings';
import { defaultSettingsForColor, type LayerDefaultsState } from './layer-default-actions';
import { pruneOrphanLayers, pushUndo, type StateSlice } from './scene-mutations';

export type FillSelectionActions = {
  readonly fillSelectionSeparately: () => void;
};

type FillSelectionState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly layerDefaults: LayerDefaultsState;
};

type FillSelectionMutation = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};

type EmptyFillSelectionMutation = Record<string, never>;

type FillSelectionSet = (
  fn: (state: FillSelectionState) => FillSelectionMutation | EmptyFillSelectionMutation,
) => void;

export function fillSelectionActions(set: FillSelectionSet): FillSelectionActions {
  return {
    fillSelectionSeparately: () => set((state) => fillSelectionMutation(state)),
  };
}

function fillSelectionMutation(
  state: FillSelectionState,
): FillSelectionMutation | EmptyFillSelectionMutation {
  const selectedIds = selectedVectorObjectIds(state);
  if (selectedIds.size === 0) return {};
  const sharedOperationId = soleOperationUsedBySelection(state.project.scene, selectedIds);
  const scene =
    sharedOperationId !== null &&
    !unselectedObjectUsesOperation(state.project.scene, selectedIds, sharedOperationId)
      ? ensureOperationIsFill(state.project.scene, sharedOperationId)
      : isolateSelectionToNewFillOperation(state, selectedIds);
  if (scene === state.project.scene) return {};
  return {
    project: { ...state.project, scene },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function isolateSelectionToNewFillOperation(
  state: FillSelectionState,
  selectedIds: ReadonlySet<string>,
): Scene {
  const first = state.project.scene.objects.find((object) => selectedIds.has(object.id));
  if (first === undefined) return state.project.scene;
  const created = createArtworkOperation(state.project.scene, first, {
    mode: 'fill',
    name: selectedIds.size === 1 ? `${artworkOperationName(first)} Fill` : 'Selection Fill',
  });
  const defaults = defaultSettingsForColor(state.layerDefaults, created.operation.color);
  const operation = {
    ...applyLayerDefaultSettings(created.operation, defaults),
    mode: 'fill' as const,
  };
  const objects = state.project.scene.objects.map((object) =>
    selectedIds.has(object.id) ? bindSceneObjectToOperations(object, [operation.id]) : object,
  );
  return pruneOrphanLayers(addLayer({ ...state.project.scene, objects }, operation));
}

function ensureOperationIsFill(scene: Scene, operationId: string): Scene {
  const operation = scene.layers.find((candidate) => candidate.id === operationId);
  if (operation === undefined || operation.mode === 'fill') return scene;
  return updateLayer(scene, operation.id, { mode: 'fill' });
}

function selectedVectorObjectIds(state: FillSelectionState): ReadonlySet<string> {
  const ids = new Set([
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ]);
  return new Set(
    state.project.scene.objects
      .filter((object) => ids.has(object.id) && isVectorObject(object))
      .map((object) => object.id),
  );
}

function soleOperationUsedBySelection(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
): string | null {
  const operationIds = new Set<string>();
  for (const object of scene.objects) {
    if (!selectedIds.has(object.id)) continue;
    for (const id of operationIdsForObject(object, scene.layers)) operationIds.add(id);
  }
  if (operationIds.size !== 1) return null;
  return [...operationIds][0] ?? null;
}

function unselectedObjectUsesOperation(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
  operationId: string,
): boolean {
  const operation = scene.layers.find((candidate) => candidate.id === operationId);
  if (operation === undefined) return false;
  return scene.objects.some(
    (object) => !selectedIds.has(object.id) && sceneObjectUsesOperation(object, operation),
  );
}

function isVectorObject(
  object: SceneObject,
): object is Extract<SceneObject, { readonly paths: ReadonlyArray<unknown> }> {
  switch (object.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return true;
    case 'raster-image':
    case 'relief':
      return false;
    default:
      return assertNever(object, 'SceneObject');
  }
}
