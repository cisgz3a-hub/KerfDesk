import { dogboneVectorObject } from '../../core/geometry/dogbone';
import {
  combineVectorObjects,
  offsetVectorObjects,
  type VectorBooleanOp,
} from '../../core/geometry/vector-path-booleans';
import {
  isVectorPathObject,
  materializeVectorObject,
  weldVectorObjects,
  type VectorSceneObject,
} from '../../core/geometry/vector-path-tools';
import { addObject, removeObject, replaceObject, type Project, type Scene } from '../../core/scene';
import type { PathNodeRef } from './path-node-edit-actions';
import { removeObjectIdsFromGroups, selectedObjectIds } from './scene-group-actions';
import {
  ensureLayersForColors,
  pruneOrphanLayers,
  pushUndo,
  type StateSlice,
} from './scene-mutations';

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
    let relieved;
    try {
      relieved = dogboneVectorObject(object, bitDiameterMm);
    } catch {
      continue; // no qualifying corners on this object — leave it alone
    }
    scene = replaceObject(scene, object.id, relieved);
    scene = ensureLayersForColors(scene, relieved.paths);
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
    scene = ensureLayersForColors(scene, materialized.paths);
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
  let welded;
  try {
    welded = weldVectorObjects(selected, uniqueWeldId(state.project.scene));
  } catch {
    return state;
  }
  const removeIds = new Set(selected.map((object) => object.id));
  let scene = state.project.scene;
  for (const id of removeIds) scene = removeObject(scene, id);
  scene = removeObjectIdsFromGroups(scene, removeIds);
  scene = ensureLayersForColors(scene, welded.paths);
  scene = addObject(scene, welded);
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

// Replace the selection with one combined object (weld's shape, different op).
function booleanSelectionMutation(
  state: VectorPathState,
  op: VectorBooleanOp,
): VectorPathMutation | VectorPathState {
  const selected = selectedVectorObjects(state.project.scene, selectedObjectIds(state));
  if (selected.length < 2 || selected.some((object) => object.locked === true)) return state;
  let combined;
  try {
    combined = combineVectorObjects(selected, op, uniqueObjectId(state.project.scene, op));
  } catch {
    return state;
  }
  const removeIds = new Set(selected.map((object) => object.id));
  let scene = state.project.scene;
  for (const id of removeIds) scene = removeObject(scene, id);
  scene = removeObjectIdsFromGroups(scene, removeIds);
  scene = ensureLayersForColors(scene, combined.paths);
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
  let offset;
  try {
    offset = offsetVectorObjects(selected, deltaMm, uniqueObjectId(state.project.scene, 'offset'));
  } catch {
    return state;
  }
  let scene = state.project.scene;
  scene = ensureLayersForColors(scene, offset.paths);
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
