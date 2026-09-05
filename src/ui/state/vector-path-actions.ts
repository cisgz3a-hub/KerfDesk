import {
  combineVectorObjects,
  dogboneVectorObject,
  isVectorPathObject,
  materializeVectorObject,
  offsetVectorObjects,
  type VectorBooleanOp,
  type VectorSceneObject,
} from '../../core/geometry';
import { canonicalArtworkOrder } from '../../core/artwork-order';
import { effectiveOperationForObject } from '../../core/effective-output';
import {
  addLayer,
  addObject,
  bindSceneObjectToOperations,
  captureLayerOperationSettings,
  createArtworkOperation,
  layerFromSubLayer,
  primaryOperationForObject,
  removeObject,
  replaceObject,
  type ImportedSvg,
  type Layer,
  type Project,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import type { PathNodeRef } from './path-node-edit-actions';
import { removeObjectIdsFromGroups, selectedObjectIds } from './scene-group-actions';
import { useToastStore } from './toast-store';
import { pruneOrphanLayers, pushUndo, type StateSlice } from './scene-mutations';
import { planWeldSelection } from './vector-path-weld-plan';

export type VectorPathActions = {
  readonly convertSelectionToPath: () => void;
  readonly weldSelection: () => void;
  // ADR-103 G1 — subject = bottom-most selected object, clips = the rest.
  readonly booleanSelection: (op: VectorBooleanOp) => void;
  // ADR-103 G1 — adds a NEW offset object; the sources stay.
  readonly offsetSelection: (deltaMm: number) => void;
  // ADR-103 G6 — relieve sharp corners in place, one undo step.
  readonly dogboneSelection: (bitDiameterMm: number) => void;
};

type VectorPathState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly selectedPathNode: PathNodeRef | null;
  readonly selectedPathNodes: ReadonlyArray<PathNodeRef>;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

type VectorPathMutation = {
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly selectedPathNode: null;
  readonly selectedPathNodes: [];
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};

type VectorPathSet = (fn: (state: VectorPathState) => VectorPathMutation | VectorPathState) => void;

export function vectorPathActions(set: VectorPathSet): VectorPathActions {
  return {
    convertSelectionToPath: () => set((state) => convertSelectionToPathMutation(state)),
    weldSelection: () => set((state) => weldSelectionMutation(state)),
    booleanSelection: (op) => set((state) => booleanSelectionMutation(state, op)),
    offsetSelection: (deltaMm) => set((state) => offsetSelectionMutation(state, deltaMm)),
    dogboneSelection: (bitDiameterMm) =>
      set((state) => dogboneSelectionMutation(state, bitDiameterMm)),
  };
}

// Replace each selected object with its corner-relieved version, in place.
function dogboneSelectionMutation(
  state: VectorPathState,
  bitDiameterMm: number,
): VectorPathMutation | VectorPathState {
  const selected = selectedVectorObjects(state.project.scene, selectedObjectIds(state));
  if (selected.length === 0 || selected.some((object) => object.locked === true)) return state;
  let scene = state.project.scene;
  let changed = false;
  for (const object of selected) {
    // Per-object skip on error (no qualifying corners / open contour) is the
    // intended silent behavior — dogbone a selection, relieve what qualifies,
    // leave the rest (WORKFLOW F-CNC26; CNV-04 keeps this one silent).
    const result = dogboneVectorObject(object, bitDiameterMm);
    if (result.kind === 'error') {
      if (result.error.kind !== 'operation-failed') continue;
      useToastStore.getState().pushToast(result.error.message, 'warning');
      return state;
    }
    const prepared = prepareCollapsedEdit(scene, object, result.value);
    scene = replaceObject(prepared.scene, object.id, prepared.object);
    changed = true;
  }
  if (!changed) return state;
  return {
    project: { ...state.project, scene },
    selectedObjectId: state.selectedObjectId,
    selectedPathNode: null,
    selectedPathNodes: [],
    additionalSelectedIds: new Set(state.additionalSelectedIds),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function convertSelectionToPathMutation(
  state: VectorPathState,
): VectorPathMutation | VectorPathState {
  const selectedIds = new Set(selectedObjectIds(state));
  if (selectedIds.size === 0) return state;
  let scene = state.project.scene;
  let changed = false;
  for (const object of state.project.scene.objects) {
    if (!selectedIds.has(object.id) || object.locked === true || !isVectorPathObject(object)) {
      continue;
    }
    const materialized = materializeVectorObject(object, object.id);
    scene = replaceObject(scene, object.id, materialized);
    changed = true;
  }
  if (!changed) return state;
  return {
    project: { ...state.project, scene },
    selectedObjectId: state.selectedObjectId,
    selectedPathNode: null,
    selectedPathNodes: [],
    additionalSelectedIds: new Set(state.additionalSelectedIds),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function weldSelectionMutation(state: VectorPathState): VectorPathMutation | VectorPathState {
  const selected = selectedVectorObjects(state.project.scene, selectedObjectIds(state));
  if (selected.length === 0 || selected.some((object) => object.locked === true)) return state;
  const weldResult = planWeldSelection(
    state.project.scene,
    selected,
    uniqueWeldId(state.project.scene),
  );
  if (weldResult.kind === 'error') {
    // The core op returns a user-worded message for reachable failures the menu
    // gating can't pre-detect (empty intersect of disjoint shapes, a collapsing
    // inward offset). Surface it instead of dead-ending silently (CNV-04/CNV-10).
    useToastStore.getState().pushToast(weldResult.error.message, 'warning');
    return state;
  }
  const welded = weldResult.value.object;
  const removeIds = new Set(selected.map((object) => object.id));
  let scene: Scene = {
    ...state.project.scene,
    objects: replaceSelectedAtEarliest(state.project.scene.objects, removeIds, welded),
    layers: weldResult.value.layers,
    ...(state.project.scene.artworkOrder === undefined
      ? {}
      : {
          artworkOrder: replaceIdsAtEarliest(
            canonicalArtworkOrder(state.project.scene),
            removeIds,
            welded.id,
          ),
        }),
  };
  scene = removeObjectIdsFromGroups(scene, removeIds);
  scene = pruneOrphanLayers(scene);
  return {
    project: { ...state.project, scene },
    selectedObjectId: welded.id,
    selectedPathNode: null,
    selectedPathNodes: [],
    additionalSelectedIds: new Set<string>(),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function replaceSelectedAtEarliest(
  objects: ReadonlyArray<SceneObject>,
  removeIds: ReadonlySet<string>,
  replacement: SceneObject,
): ReadonlyArray<SceneObject> {
  let inserted = false;
  return objects.flatMap((object) => {
    if (!removeIds.has(object.id)) return [object];
    if (inserted) return [];
    inserted = true;
    return [replacement];
  });
}

function replaceIdsAtEarliest(
  ids: ReadonlyArray<string>,
  removeIds: ReadonlySet<string>,
  replacementId: string,
): ReadonlyArray<string> {
  let inserted = false;
  return ids.flatMap((id) => {
    if (!removeIds.has(id)) return [id];
    if (inserted) return [];
    inserted = true;
    return [replacementId];
  });
}

// Replace the selection with one combined object (weld's shape, different op).
function booleanSelectionMutation(
  state: VectorPathState,
  op: VectorBooleanOp,
): VectorPathMutation | VectorPathState {
  const selected = selectedVectorObjects(state.project.scene, selectedObjectIds(state));
  if (selected.length < 2 || selected.some((object) => object.locked === true)) return state;
  const combineResult = combineVectorObjects(selected, op, uniqueObjectId(state.project.scene, op));
  if (combineResult.kind === 'error') {
    useToastStore.getState().pushToast(combineResult.error.message, 'warning');
    return state;
  }
  const prepared = prepareIndependentArtwork(state.project.scene, combineResult.value, selected[0]);
  const combined = prepared.object;
  const removeIds = new Set(selected.map((object) => object.id));
  let scene = prepared.scene;
  for (const id of removeIds) scene = removeObject(scene, id);
  scene = removeObjectIdsFromGroups(scene, removeIds);
  scene = addObject(scene, combined);
  scene = pruneOrphanLayers(scene);
  return {
    project: { ...state.project, scene },
    selectedObjectId: combined.id,
    selectedPathNode: null,
    selectedPathNodes: [],
    additionalSelectedIds: new Set<string>(),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

// Adds the offset result as a new object; sources stay put and selected.
function offsetSelectionMutation(
  state: VectorPathState,
  deltaMm: number,
): VectorPathMutation | VectorPathState {
  const selected = selectedVectorObjects(state.project.scene, selectedObjectIds(state));
  if (selected.length === 0 || selected.some((object) => object.locked === true)) return state;
  const offsetResult = offsetVectorObjects(
    selected,
    deltaMm,
    uniqueObjectId(state.project.scene, 'offset'),
  );
  if (offsetResult.kind === 'error') {
    useToastStore.getState().pushToast(offsetResult.error.message, 'warning');
    return state;
  }
  const prepared = prepareIndependentArtwork(state.project.scene, offsetResult.value, selected[0]);
  const offset = prepared.object;
  let scene = prepared.scene;
  scene = addObject(scene, offset);
  return {
    project: { ...state.project, scene },
    selectedObjectId: offset.id,
    selectedPathNode: null,
    selectedPathNodes: [],
    additionalSelectedIds: new Set<string>(),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function prepareIndependentArtwork(
  scene: Scene,
  artwork: ImportedSvg,
  source: SceneObject | undefined,
): { readonly scene: Scene; readonly object: ImportedSvg } {
  const sourceOperation =
    source === undefined ? null : primaryOperationForObject(source, scene.layers);
  const seed = createArtworkOperation(scene, artwork, {
    subLayers: sourceOperation?.subLayers ?? [],
  });
  const operation: Layer =
    sourceOperation === null
      ? seed.operation
      : independentOperationForArtwork(sourceOperation, seed.operation, artwork);
  return {
    scene: addLayer(scene, operation),
    object: seed.object as ImportedSvg,
  };
}

function independentOperationForArtwork(source: Layer, seed: Layer, artwork: ImportedSvg): Layer {
  const effectiveRoot = effectiveOperationForObject(source, artwork);
  const subLayers = source.subLayers.map((subLayer) => ({
    ...subLayer,
    settings: captureLayerOperationSettings(
      effectiveOperationForObject(layerFromSubLayer(source, subLayer), artwork),
    ),
  }));
  const { bindingOperationId: _bindingOperationId, ...withoutRuntimeBinding } = effectiveRoot;
  const cloned: Layer = {
    ...withoutRuntimeBinding,
    id: seed.id,
    name: seed.name,
    color: seed.color,
    subLayers,
  };
  if (artwork.operationOverride === undefined) return cloned;
  // The override is materialized into the root and every sublayer, so a later
  // linked-preset refresh must not silently erase the derived artwork's output.
  const { materialBinding: _materialBinding, ...detached } = cloned;
  return detached;
}

function prepareCollapsedEdit(
  scene: Scene,
  source: VectorSceneObject,
  artwork: ImportedSvg,
): { readonly scene: Scene; readonly object: ImportedSvg } {
  const sourceOperation = primaryOperationForObject(source, scene.layers);
  const withMetadata: ImportedSvg = {
    ...artwork,
    ...(source.locked === undefined ? {} : { locked: source.locked }),
    ...(source.powerScale === undefined ? {} : { powerScale: source.powerScale }),
    ...(source.operationOverride === undefined
      ? {}
      : { operationOverride: source.operationOverride }),
  };
  if (sourceOperation !== null) {
    return {
      scene,
      object: bindSceneObjectToOperations(withMetadata, [sourceOperation.id]) as ImportedSvg,
    };
  }
  const created = createArtworkOperation(scene, withMetadata);
  return {
    scene: addLayer(scene, created.operation),
    object: created.object as ImportedSvg,
  };
}

function selectedVectorObjects(
  scene: Scene,
  selectedIds: ReadonlyArray<string>,
): ReadonlyArray<VectorSceneObject> {
  const selected = new Set(selectedIds);
  return scene.objects.filter(
    (object): object is VectorSceneObject => selected.has(object.id) && isVectorPathObject(object),
  );
}

function uniqueWeldId(scene: Scene): string {
  return uniqueObjectId(scene, 'welded');
}

function uniqueObjectId(scene: Scene, base: string): string {
  const used = new Set(scene.objects.map((object) => object.id));
  if (!used.has(`${base}-paths`)) return `${base}-paths`;
  for (let index = 2; index <= MAX_ID_SUFFIX; index += 1) {
    const id = `${base}-paths-${index}`;
    if (!used.has(id)) return id;
  }
  return `${base}-paths-${crypto.randomUUID()}`;
}

const MAX_ID_SUFFIX = 1000;
