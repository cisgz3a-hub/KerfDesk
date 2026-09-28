// Optimize Shapes (LightBurn gap LBG-T22): smooth and fit the selected vector
// artwork as one undo step, and say what happened: how many points became how
// many segments, how far the outlines moved at most, which text and drawn
// shapes became paths, and which locked objects were left alone. When nothing
// would change, nothing is recorded and the notice says so.

import type { ShapeOptimizeOptions } from '../../core/geometry/shape-optimize/shape-optimize-options';
import { clampShapeOptimizeOptions } from '../../core/geometry/shape-optimize/shape-optimize-options';
import {
  optimizedSceneObject,
  optimizeShapesSelection,
  planReusing,
  type OptimizeShapesPlan,
} from './optimize-shapes-plan';
import { optimizeShapesNotice, optimizeShapesSelectionProblem } from './optimize-shapes-notice';
import { selectedObjectIds } from './scene-group-actions';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { useToastStore } from './toast-store';
import type { SceneObject } from '../../core/scene/scene-object';

export type OptimizeShapesActions = {
  /**
   * Optimize the selected vector artwork; true when anything changed. `ready`
   * is the dialog's finished plan, used for every object it still matches.
   */
  readonly optimizeSelectedShapes: (
    options: ShapeOptimizeOptions,
    ready?: OptimizeShapesPlan | null,
  ) => boolean;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function optimizeShapesActions(set: Setter): OptimizeShapesActions {
  return {
    optimizeSelectedShapes: (options, ready = null) => {
      let changed = false;
      set((state) => {
        const next = optimizeShapesMutation(state, clampShapeOptimizeOptions(options), ready);
        changed = next !== state;
        return next;
      });
      return changed;
    },
  };
}

export function optimizeShapesMutation(
  state: AppState,
  options: ShapeOptimizeOptions,
  ready: OptimizeShapesPlan | null,
): AppState | Partial<AppState> {
  const scene = state.project.scene;
  const selection = optimizeShapesSelection(scene, selectedObjectIds(state));
  const problem = optimizeShapesSelectionProblem(selection);
  if (problem !== null) {
    notify(problem, 'warning');
    return state;
  }
  const plan = planReusing(selection.targets, options, ready);
  const replacements = new Map<string, SceneObject>();
  for (const entry of plan.objects) {
    const optimized = optimizedSceneObject(entry);
    if (optimized !== null) replacements.set(entry.source.id, optimized);
  }
  notify(optimizeShapesNotice(plan, replacements.size, selection.locked), 'info');
  if (replacements.size === 0) return state;
  const objects = scene.objects.map((object) => replacements.get(object.id) ?? object);
  return {
    project: { ...state.project, scene: { ...scene, objects } },
    undoStack: pushUndo(state.project, state.undoStack, 'Optimize Shapes'),
    redoStack: [],
    dirty: true,
    selectedPathNode: null,
    selectedPathNodes: [],
  };
}

function notify(message: string, kind: 'info' | 'warning'): void {
  useToastStore.getState().pushToast(message, kind);
}
