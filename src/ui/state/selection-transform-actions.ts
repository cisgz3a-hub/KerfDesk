import {
  buildSelectionAlignEdit,
  buildSelectionDistributeEdit,
  buildSelectionFlipEdit,
  buildSelectionNudgeEdit,
  type Project,
  type SceneObject,
  type SelectionAlignKind,
  type SelectionDistributeKind,
  type SelectionFlipAxis,
  type Transform,
} from '../../core/scene';
import type { AppState } from './store';
import { pushUndo } from './scene-mutations';

export type SelectionTransformEdit = {
  readonly id: string;
  readonly transform: Transform;
};

export type SelectionTransformActions = {
  readonly applySelectionTransforms: (edits: ReadonlyArray<SelectionTransformEdit>) => void;
  readonly alignSelection: (kind: SelectionAlignKind) => void;
  readonly distributeSelection: (kind: SelectionDistributeKind) => void;
  readonly nudgeSelection: (dx: number, dy: number) => void;
  readonly flipSelection: (axis: SelectionFlipAxis) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function selectionTransformActions(set: Setter): SelectionTransformActions {
  return {
    applySelectionTransforms: (edits) =>
      set((state) => applySelectionTransformsToState(state, edits)),
    alignSelection: (kind) => set((state) => applySelectionAlignToState(state, kind)),
    distributeSelection: (kind) => set((state) => applySelectionDistributeToState(state, kind)),
    nudgeSelection: (dx, dy) => set((state) => applySelectionNudgeToState(state, dx, dy)),
    flipSelection: (axis) => set((state) => applySelectionFlipToState(state, axis)),
  };
}

function applySelectionAlignToState(
  state: AppState,
  kind: SelectionAlignKind,
): AppState | Partial<AppState> {
  const ids = selectedObjectIds(state);
  const referenceId = ids[ids.length - 1];
  if (referenceId === undefined) return state;
  const result = buildSelectionAlignEdit(selectedObjects(state.project.scene.objects, ids), {
    kind,
    referenceId,
  });
  if (result.kind === 'error') return state;
  return applySelectionTransformsToState(state, result.transforms);
}

function applySelectionDistributeToState(
  state: AppState,
  kind: SelectionDistributeKind,
): AppState | Partial<AppState> {
  const ids = selectedObjectIds(state);
  const result = buildSelectionDistributeEdit(selectedObjects(state.project.scene.objects, ids), {
    kind,
  });
  if (result.kind === 'error') return state;
  return applySelectionTransformsToState(state, result.transforms);
}

function applySelectionNudgeToState(
  state: AppState,
  dx: number,
  dy: number,
): AppState | Partial<AppState> {
  const ids = selectedObjectIds(state);
  const result = buildSelectionNudgeEdit(selectedObjects(state.project.scene.objects, ids), dx, dy);
  if (result.kind === 'error') return state;
  return applySelectionTransformsToState(state, result.transforms);
}

function applySelectionFlipToState(
  state: AppState,
  axis: SelectionFlipAxis,
): AppState | Partial<AppState> {
  const ids = selectedObjectIds(state);
  const result = buildSelectionFlipEdit(selectedObjects(state.project.scene.objects, ids), axis);
  if (result.kind === 'error') return state;
  return applySelectionTransformsToState(state, result.transforms);
}

function applySelectionTransformsToState(
  state: AppState,
  edits: ReadonlyArray<SelectionTransformEdit>,
): AppState | Partial<AppState> {
  if (edits.length === 0) return state;
  const byId = new Map(edits.map((edit) => [edit.id, edit.transform]));
  let changed = false;
  const nextProject: Project = {
    ...state.project,
    scene: {
      ...state.project.scene,
      objects: state.project.scene.objects.map((object) => {
        const transform = byId.get(object.id);
        if (transform === undefined) return object;
        changed = true;
        return { ...object, transform };
      }),
    },
  };
  if (!changed) return state;
  return {
    project: nextProject,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function selectedObjectIds(state: AppState): ReadonlyArray<string> {
  return [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ];
}

function selectedObjects(
  objects: ReadonlyArray<SceneObject>,
  ids: ReadonlyArray<string>,
): ReadonlyArray<SceneObject> {
  return ids
    .map((id) => objects.find((object) => object.id === id))
    .filter((object): object is SceneObject => object !== undefined);
}
