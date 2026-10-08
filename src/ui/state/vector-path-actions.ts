import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
import {
  replaceSelectedAtEarliest,
  replaceIdsAtEarliest,
  selectedVectorObjects,
  expectedSelection,
  uniqueWeldId,
  uniqueObjectId,
  placeRetainedCompound,
  compoundSceneBudgetIsValid,
} from './vector-path-selection';
import { pruneDesignTreeOrder } from '../../core/scene/design-hierarchy-order';
export { uniqueObjectId } from './vector-path-selection';
import { retainBooleanCompoundResult } from '../../core/geometry/boolean-compound';
import { booleanCompoundActions, type BooleanCompoundActions } from './boolean-compound-actions';
import {
  combineVectorObjects,
  isVectorPathObject,
  materializeVectorObject,
  offsetVectorObjects,
  type VectorBooleanOp,
  type VectorSceneObject,
} from '../../core/geometry';
import { dogboneOperationRegions } from '../../core/geometry/dogbone-operations';
import { canonicalArtworkOrder } from '../../core/artwork-order';
import { effectiveOperationForObject } from '../../core/effective-output';
import {
  addLayer,
  addObject,
  captureLayerOperationSettings,
  createArtworkOperation,
  layerFromSubLayer,
  operationIdsForObject,
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
import { vectorRepairActions, type VectorRepairActions } from './vector-repair-actions';

export type VectorCombineOptions = {
  readonly keepOperands?: boolean;
  readonly retainCompound?: boolean;
  readonly expectedProject?: Project;
  readonly expectedIds?: ReadonlyArray<string>;
  readonly isCurrent?: () => boolean;
};

export type VectorPathActions = VectorRepairActions &
  BooleanCompoundActions & {
    readonly convertSelectionToPath: () => void;
    readonly weldSelection: (options?: VectorCombineOptions) => void;
    // ADR-103 G1 â€” subject = bottom-most selected object, clips = the rest.
    readonly booleanSelection: (op: VectorBooleanOp, options?: VectorCombineOptions) => void;
    // ADR-103 G1 â€” adds a NEW offset object; the sources stay.
    readonly offsetSelection: (deltaMm: number) => void;
    // ADR-103 G6 â€” relieve sharp corners in place, one undo step.
    readonly dogboneSelection: (bitDiameterMm: number) => void;
  };

export type VectorPathState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly selectedPathNode: PathNodeRef | null;
  readonly selectedPathNodes: ReadonlyArray<PathNodeRef>;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

export type VectorPathMutation = {
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly selectedPathNode: null;
  readonly selectedPathNodes: [];
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};

export type VectorPathSet = (
  fn: (state: VectorPathState) => VectorPathMutation | VectorPathState,
  onCommitted?: () => void,
  isCurrent?: () => boolean,
) => void;

export function vectorPathActions(
  set: VectorPathSet,
  copySet: VectorPathSet = set,
  weldSet: VectorPathSet = set,
): VectorPathActions {
  return {
    ...vectorRepairActions(set),
    ...booleanCompoundActions(set),
    convertSelectionToPath: () => set((state) => convertSelectionToPathMutation(state)),
    weldSelection: (options = {}) =>
      (options.keepOperands ? copySet : weldSet)(
        (state) =>
          expectedSelection(state, options)
            ? weldSelectionMutation(
                state,
                options.keepOperands === true,
                options.retainCompound === true,
              )
            : state,
        undefined,
        options.isCurrent,
      ),
    booleanSelection: (op, options = {}) =>
      copySet(
        (state) =>
          expectedSelection(state, options)
            ? booleanSelectionMutation(
                state,
                op,
                options.keepOperands === true,
                options.retainCompound === true,
              )
            : state,
        undefined,
        options.isCurrent,
      ),
    offsetSelection: (deltaMm) => copySet((state) => offsetSelectionMutation(state, deltaMm)),
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
    // intended silent behavior â€” dogbone a selection, relieve what qualifies,
    // leave the rest (WORKFLOW F-CNC26; CNV-04 keeps this one silent).
    const result = dogboneOperationRegions(object, bitDiameterMm, scene.layers);
    if (result.kind === 'error') {
      if (result.error.kind !== 'operation-failed') continue;
      useToastStore.getState().pushToast(result.error.message, 'warning');
      return state;
    }
    const prepared = prepareDogboneEdit(scene, object, result.value);
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
    if (isBooleanCompoundObject(object)) continue;
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

function weldSelectionMutation(
  state: VectorPathState,
  keepOperands = false,
  retainCompound = false,
): VectorPathMutation | VectorPathState {
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
  const captured = retainBooleanCompoundResult(
    weldResult.value.object,
    'weld',
    weldResult.value.operands,
    retainCompound,
  );
  if (captured.kind === 'error') {
    useToastStore.getState().pushToast(captured.error.message, 'warning');
    return state;
  }
  const welded = captured.value;
  const removeIds = new Set(selected.map((object) => object.id));
  let scene: Scene = {
    ...state.project.scene,
    objects: keepOperands
      ? [...state.project.scene.objects, welded]
      : replaceSelectedAtEarliest(state.project.scene.objects, removeIds, welded),
    layers: weldResult.value.layers,
    ...(state.project.scene.artworkOrder === undefined
      ? {}
      : {
          artworkOrder: keepOperands
            ? [...canonicalArtworkOrder(state.project.scene), welded.id]
            : replaceIdsAtEarliest(
                canonicalArtworkOrder(state.project.scene),
                removeIds,
                welded.id,
              ),
        }),
  };
  if (!keepOperands) scene = removeObjectIdsFromGroups(scene, removeIds);
  scene = pruneDesignTreeOrder(pruneOrphanLayers(scene));
  if (!compoundSceneBudgetIsValid(state.project.scene, scene, retainCompound)) return state;
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

// Replace the selection with one combined object (weld's shape, different op).
function booleanSelectionMutation(
  state: VectorPathState,
  op: VectorBooleanOp,
  keepOperands = false,
  retainCompound = false,
): VectorPathMutation | VectorPathState {
  const selected = selectedVectorObjects(state.project.scene, selectedObjectIds(state));
  if (selected.length < 2 || selected.some((object) => object.locked === true)) return state;
  const combineResult = combineVectorObjects(selected, op, uniqueObjectId(state.project.scene, op));
  if (combineResult.kind === 'error') {
    useToastStore.getState().pushToast(combineResult.error.message, 'warning');
    return state;
  }
  const prepared = prepareIndependentArtwork(state.project.scene, combineResult.value, selected[0]);
  const captured = retainBooleanCompoundResult(prepared.object, op, selected, retainCompound);
  if (captured.kind === 'error') {
    useToastStore.getState().pushToast(captured.error.message, 'warning');
    return state;
  }
  const combined = captured.value;
  const removeIds = new Set(selected.map((object) => object.id));
  let scene = prepared.scene;
  if (!keepOperands) {
    for (const id of removeIds) scene = removeObject(scene, id);
    scene = removeObjectIdsFromGroups(scene, removeIds);
  }
  scene = addObject(scene, combined);
  scene = placeRetainedCompound(
    state.project.scene,
    scene,
    removeIds,
    combined,
    retainCompound && !keepOperands,
  );
  scene = pruneDesignTreeOrder(pruneOrphanLayers(scene));
  if (!compoundSceneBudgetIsValid(state.project.scene, scene, retainCompound)) return state;
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

export function prepareIndependentArtwork(
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

function prepareDogboneEdit(
  scene: Scene,
  source: VectorSceneObject,
  artwork: ImportedSvg,
): { readonly scene: Scene; readonly object: ImportedSvg } {
  const withMetadata: ImportedSvg = {
    ...artwork,
    ...(source.locked === undefined ? {} : { locked: source.locked }),
    ...(source.powerScale === undefined ? {} : { powerScale: source.powerScale }),
    ...(source.operationOverride === undefined
      ? {}
      : { operationOverride: source.operationOverride }),
  };
  if (operationIdsForObject(source, scene.layers).length > 0) {
    return {
      scene,
      object: withMetadata,
    };
  }
  const created = createArtworkOperation(scene, withMetadata);
  return {
    scene: addLayer(scene, created.operation),
    object: created.object as ImportedSvg,
  };
}
