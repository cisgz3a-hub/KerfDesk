import {
  evaluateBooleanCompound,
  expandBooleanCompound,
} from '../../core/geometry/boolean-compound';
import { isBooleanCompoundObject, type BooleanCompound } from '../../core/scene/boolean-compound';
import { sceneLimitOverrun } from './scene-copy-room';
import type { Project } from '../../core/scene';
import { pushUndo } from './scene-mutations';
import { useToastStore } from './toast-store';
import type { VectorPathMutation, VectorPathSet, VectorPathState } from './vector-path-actions';

export type BooleanCompoundActions = {
  readonly editBooleanCompound: (
    id: string,
    compound: BooleanCompound,
    expectedProject: Project,
  ) => void;
  readonly expandBooleanCompound: (id: string, expectedProject: Project) => void;
};
export function booleanCompoundActions(set: VectorPathSet): BooleanCompoundActions {
  return {
    editBooleanCompound: (id, compound, expected) =>
      set((state) => updateCompound(state, id, compound, expected)),
    expandBooleanCompound: (id, expected) =>
      set((state) => updateCompound(state, id, null, expected)),
  };
}
function updateCompound(
  state: VectorPathState,
  id: string,
  compound: BooleanCompound | null,
  expected: Project,
): VectorPathMutation | VectorPathState {
  if (state.project !== expected) return state;
  const original = state.project.scene.objects.find((object) => object.id === id);
  if (original === undefined || !isBooleanCompoundObject(original) || original.locked === true)
    return state;
  if (compound === original.booleanCompound) return state;
  const result =
    compound === null
      ? { kind: 'ok' as const, value: expandBooleanCompound(original) }
      : evaluateBooleanCompound(original, compound);
  if (result.kind === 'error') {
    useToastStore.getState().pushToast(result.error.message, 'warning');
    return state;
  }
  const scene = {
    ...state.project.scene,
    objects: state.project.scene.objects.map((object) =>
      object === original ? result.value : object,
    ),
  };
  const budgetError = sceneLimitOverrun(state.project.scene, scene);
  if (budgetError !== null) {
    useToastStore.getState().pushToast(budgetError, 'warning');
    return state;
  }
  return {
    project: { ...state.project, scene },
    selectedObjectId: id,
    selectedPathNode: null,
    selectedPathNodes: [],
    additionalSelectedIds: new Set(),
    undoStack: pushUndo(
      state.project,
      state.undoStack,
      compound === null ? 'Expand compound' : 'Edit compound sources',
    ),
    redoStack: [],
    dirty: true,
  };
}
