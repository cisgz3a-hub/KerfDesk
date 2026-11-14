import {
  replaceSelectedAtEarliest,
  replaceIdsAtEarliest,
  selectedVectorObjects,
  placeRetainedCompound,
  compoundSceneBudgetIsValid,
} from './vector-path-selection';
import { pruneDesignTreeOrder } from '../../core/scene/design-hierarchy-order';
export { uniqueObjectId } from './vector-path-selection';
export { prepareIndependentArtwork } from './independent-artwork';
import { prepareIndependentArtwork } from './independent-artwork';
import { retainBooleanCompoundResult } from '../../core/geometry/boolean-compound';
import { booleanCompoundActions, type BooleanCompoundActions } from './boolean-compound-actions';
import { type VectorBooleanOp, type VectorSceneObject } from '../../core/geometry';
import { dogboneOperationRegions } from '../../core/geometry/dogbone-operations';
import { canonicalArtworkOrder } from '../../core/artwork-order';
import {
  addLayer,
  addObject,
  createArtworkOperation,
  operationIdsForObject,
  primaryOperationForObject,
  removeObject,
  replaceObject,
  type ImportedSvg,
  type Project,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { inheritRegistrationArtworkOutput } from './registration-output-actions';
import type { PathNodeRef } from './path-node-edit-actions';
import { combineSelectionNotingTabs, removedTabsNotice } from './removed-tabs-notice';
import { removeObjectIdsFromGroups, selectedObjectIds } from './scene-group-actions';
import { useToastStore } from './toast-store';
import { convertSelectionToPathMutation } from './convert-to-path-mutation';
import { pruneOrphanLayers, pushUndo, type StateSlice } from './scene-mutations';
import {
  combineForSelection,
  offsetOutlinesForSelection,
  weldPlanForSelection,
  type PreparedOffsetPaths,
  type PreparedVectorCombine,
} from './vector-op-prepared';
import { vectorRepairActions, type VectorRepairActions } from './vector-repair-actions';

export type VectorCombineOptions = {
  readonly keepOperands?: boolean;
  readonly retainCompound?: boolean;
  readonly expectedProject?: Project;
  readonly expectedIds?: ReadonlyArray<string>;
  readonly isCurrent?: () => boolean;
  /** A dialog's settled background result, committed when its inputs still match (ADR-609). */
  readonly prepared?: PreparedVectorCombine;
};

export type VectorPathActions = VectorRepairActions &
  BooleanCompoundActions & {
    readonly convertSelectionToPath: () => void;
    readonly weldSelection: (options?: VectorCombineOptions) => void;
    // ADR-103 G1 â€” subject = bottom-most selected object, clips = the rest.
    readonly booleanSelection: (op: VectorBooleanOp, options?: VectorCombineOptions) => void;
    // ADR-103 G1 â€” adds a NEW offset object; the sources stay.
    readonly offsetSelection: (deltaMm: number, prepared?: PreparedOffsetPaths) => void;
    // ADR-103 G6 â€” relieve sharp corners in place, one undo step.
    readonly dogboneSelection: (bitDiameterMm: number) => void;
  };

export type VectorPathState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly selectedPathNode: PathNodeRef | null;
  readonly selectedPathNodes: ReadonlyArray<PathNodeRef>;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly registrationArtworkOutputSnapshot?: Readonly<Record<string, boolean>> | null;
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
  readonly registrationArtworkOutputSnapshot?: Readonly<Record<string, boolean>>;
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
      combineSelectionNotingTabs(
        options.keepOperands ? copySet : weldSet,
        options,
        'welded shapes',
        (state) =>
          weldSelectionMutation(
            state,
            options.keepOperands === true,
            options.retainCompound === true,
            options.prepared,
          ),
      ),
    booleanSelection: (op, options = {}) =>
      combineSelectionNotingTabs(copySet, options, 'combined shapes', (state) =>
        booleanSelectionMutation(
          state,
          op,
          options.keepOperands === true,
          options.retainCompound === true,
          options.prepared,
        ),
      ),
    offsetSelection: (deltaMm, prepared) =>
      copySet((state) => offsetSelectionMutation(state, deltaMm, prepared)),
    dogboneSelection: (bitDiameterMm) => {
      let notice = '';
      set((state) =>
        dogboneSelectionMutation(state, bitDiameterMm, (relieved) => {
          notice = removedTabsNotice(relieved, 'relieved shapes');
        }),
      );
      if (notice !== '') useToastStore.getState().pushToast(notice, 'info');
    },
  };
}

// Replace each selected object with its corner-relieved version, in place. The
// relieved outline has none of the tabs placed by hand on its source (ADR-494
// Amendment 4), so `onRelieved` names the objects that lost theirs.
function dogboneSelectionMutation(
  state: VectorPathState,
  bitDiameterMm: number,
  onRelieved: (relieved: ReadonlyArray<SceneObject>) => void,
): VectorPathMutation | VectorPathState {
  const selected = selectedVectorObjects(state.project.scene, selectedObjectIds(state), 'variable');
  if (selected.length === 0 || selected.some((object) => object.locked === true)) return state;
  let scene = state.project.scene;
  let changed = false;
  const relieved: SceneObject[] = [];
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
    relieved.push(object);
  }
  if (!changed) return state;
  onRelieved(relieved);
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
  background?: PreparedVectorCombine,
): VectorPathMutation | VectorPathState {
  const selected = selectedVectorObjects(state.project.scene, selectedObjectIds(state), 'replace');
  if (selected.length === 0 || selected.some((object) => object.locked === true)) return state;
  const weldResult = weldPlanForSelection(state.project.scene, selected, background);
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
  background?: PreparedVectorCombine,
): VectorPathMutation | VectorPathState {
  const selected = selectedVectorObjects(state.project.scene, selectedObjectIds(state), 'replace');
  if (selected.length < 2 || selected.some((object) => object.locked === true)) return state;
  const combineResult = combineForSelection(state.project.scene, selected, op, background);
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
  background?: PreparedOffsetPaths,
): VectorPathMutation | VectorPathState {
  const selected = selectedVectorObjects(state.project.scene, selectedObjectIds(state), 'variable');
  if (selected.length === 0 || selected.some((object) => object.locked === true)) return state;
  const offsetResult = offsetOutlinesForSelection(
    state.project.scene,
    selected,
    deltaMm,
    background,
  );
  if (offsetResult.kind === 'error') {
    useToastStore.getState().pushToast(offsetResult.error.message, 'warning');
    return state;
  }
  const prepared = prepareIndependentArtwork(state.project.scene, offsetResult.value, selected[0]);
  const offset = prepared.object;
  let scene = prepared.scene;
  scene = addObject(scene, offset);
  // A jig's Outline only must not leave the art's offset off in Artwork only.
  const source =
    selected[0] === undefined ? null : primaryOperationForObject(selected[0], scene.layers);
  const project = { ...state.project, scene };
  const cloneId = offset.operationIds?.[0];
  const jig =
    source === null || cloneId === undefined
      ? null
      : inheritRegistrationArtworkOutput(state, project, [{ sourceId: source.id, cloneId }]);
  return {
    ...(jig ?? { project }),
    selectedObjectId: offset.id,
    selectedPathNode: null,
    selectedPathNodes: [],
    additionalSelectedIds: new Set<string>(),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
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
