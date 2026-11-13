import {
  addLayer,
  artworkOperationName,
  assertNever,
  bindSceneObjectToOperations,
  createArtworkOperation,
  operationIdsForObject,
  sceneObjectUsesOperation,
  updateLayer,
  type Layer,
  type Project,
  type Scene,
  type SceneObject,
  machineKindOf,
} from '../../core/scene';
import { applyLayerDefaultSettings } from '../layers/layer-default-settings';
import { defaultSettingsForOperation, type LayerDefaultsState } from './layer-default-actions';
import { pruneOrphanLayers, pushUndo, type StateSlice } from './scene-mutations';
import { seedFreshCncLayer } from './cnc-auto-seeding';
import type { CncLiveCapsState } from './cnc-live-caps-actions';
import { sceneWithModeSwitchRecipe, seedFreshLaserLayer } from './laser-recipe-seeding';
import type { MaterialLibraryDocument } from '../../io/material-library';

export type FillSelectionActions = {
  readonly fillSelectionSeparately: () => void;
};

type FillSelectionState = StateSlice &
  CncLiveCapsState & {
    readonly selectedObjectId: string | null;
    readonly additionalSelectedIds: ReadonlySet<string>;
    readonly layerDefaults: LayerDefaultsState;
    readonly materialLibrary?: MaterialLibraryDocument | null;
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
      ? ensureOperationIsFill(state, sharedOperationId)
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
  const sourceFill = soleFillOperationOfSelection(state.project.scene, selectedIds);
  const operation =
    sourceFill === null
      ? freshFillOperation(state, created)
      : // The selection already burns through one Fill: the separated copy keeps
        // its tuned settings and recipe link, as Make unique does (T06-P2-1).
        {
          ...sourceFill,
          id: created.operation.id,
          name: created.operation.name,
          color: created.operation.color,
        };
  const objects = state.project.scene.objects.map((object) =>
    selectedIds.has(object.id) ? bindSceneObjectToOperations(object, [operation.id]) : object,
  );
  return pruneOrphanLayers(addLayer({ ...state.project.scene, objects }, operation));
}

function freshFillOperation(
  state: FillSelectionState,
  created: ReturnType<typeof createArtworkOperation>,
): Layer {
  const defaults = defaultSettingsForOperation(
    state.layerDefaults,
    [created.object],
    created.operation,
  );
  const withDefaults = {
    ...applyLayerDefaultSettings(created.operation, defaults, machineKindOf(state.project.machine)),
    mode: 'fill' as const,
  };
  const machine = state.project.machine;
  return machine?.kind === 'cnc'
    ? seedFreshCncLayer(withDefaults, {
        device: state.project.device,
        machine,
        liveCaps: state.cncLiveCaps,
      })
    : seedFreshLaserLayer(withDefaults, state.project, state.materialLibrary ?? null);
}

/** The one Fill operation the selection burns through, when there is exactly
 * one and it carries no sub-layers (their ids follow the operation's id). */
function soleFillOperationOfSelection(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
): Layer | null {
  const fills = new Map<string, Layer>();
  for (const object of scene.objects) {
    if (!selectedIds.has(object.id)) continue;
    for (const id of operationIdsForObject(object, scene.layers)) {
      const layer = scene.layers.find((candidate) => candidate.id === id);
      if (layer?.mode === 'fill') fills.set(layer.id, layer);
    }
  }
  const [only] = fills.values();
  return fills.size === 1 && only !== undefined && only.subLayers.length === 0 ? only : null;
}

// The same switch as the inspector's Fill mode (setLayerParam): an operation
// still as its linked recipe left it takes the best Fill recipe, so a cut
// switched to Fill does not engrave at cutting power (ADR-496 §6, T06-P1-1).
function ensureOperationIsFill(state: FillSelectionState, operationId: string): Scene {
  const scene = state.project.scene;
  const operation = scene.layers.find((candidate) => candidate.id === operationId);
  if (operation === undefined || operation.mode === 'fill') return scene;
  return sceneWithModeSwitchRecipe(
    state.project,
    updateLayer(scene, operation.id, { mode: 'fill' }),
    operation.id,
    { mode: 'fill' },
    state.materialLibrary ?? null,
  );
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
