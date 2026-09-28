// Cut Shapes (LightBurn gap LBG-T08): the top-most selected closed shape cuts
// the other selected vector objects it crosses into the part inside it and
// the part outside it, and is removed. The pieces take their source's place
// in the stacking and run order, burn with its operations, and end up
// selected so they can be moved apart. One undo step. A selection it cannot
// cut gets a notice saying why, and nothing changes.

import { planCutShapes, type CutShapesPlan } from '../../core/geometry/cut-shapes';
import { isUnlockedVectorArtwork } from '../../core/geometry/trim-contours';
import type { Scene, SceneObject } from '../../core/scene';
import { repairDanglingObjectDependencies, reportDependencyRepairs } from './object-delete-actions';
import { removeObjectIdsFromGroups, selectedObjectIds } from './scene-group-actions';
import { pruneOrphanLayers, pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { useToastStore } from './toast-store';

export type CutShapesActions = {
  /** Cut the selection with its top-most closed shape; true when anything was cut. */
  readonly cutSelectedShapes: () => boolean;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function cutShapesActions(set: Setter): CutShapesActions {
  return {
    cutSelectedShapes: () => {
      let cut = false;
      set((state) => {
        const next = cutShapesMutation(state);
        cut = next !== state;
        return next;
      });
      return cut;
    },
  };
}

function cutShapesMutation(state: AppState): AppState | Partial<AppState> {
  const ids = new Set(selectedObjectIds(state));
  const scene = state.project.scene;
  const selected = scene.objects.filter((object) => ids.has(object.id));
  const plan = planCutShapes(
    selected.filter(isUnlockedVectorArtwork),
    new Set(scene.objects.map((object) => object.id)),
  );
  if (plan.kind === 'error') {
    useToastStore.getState().pushToast(plan.error.message, 'warning');
    return state;
  }
  const pieces = plan.value.cuts.flatMap((cut) => cut.pieces.map((piece) => piece.id));
  const repaired = repairDanglingObjectDependencies(applyCut(scene, plan.value));
  reportDependencyRepairs(repaired);
  useToastStore.getState().pushToast(cutMessage(plan.value, selected.length), 'success');
  return {
    project: { ...state.project, scene: pruneOrphanLayers(repaired.scene) },
    selectedObjectId: pieces[0] ?? null,
    additionalSelectedIds: new Set(pieces.slice(1)),
    selectedPathNode: null,
    selectedPathNodes: [],
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

/** The scene with each cut source replaced in place by its pieces and the cutter removed. */
function applyCut(scene: Scene, plan: CutShapesPlan): Scene {
  const pieces = new Map<string, ReadonlyArray<SceneObject>>(
    plan.cuts.map((cut) => [cut.sourceId, cut.pieces]),
  );
  const replace = <T>(id: string, keep: T, map: (piece: SceneObject) => T): ReadonlyArray<T> =>
    id === plan.cutterId ? [] : (pieces.get(id)?.map(map) ?? [keep]);
  const next: Scene = {
    ...scene,
    objects: scene.objects.flatMap((object) => replace(object.id, object, (piece) => piece)),
    ...(scene.artworkOrder === undefined
      ? {}
      : { artworkOrder: scene.artworkOrder.flatMap((id) => replace(id, id, (piece) => piece.id)) }),
  };
  return removeObjectIdsFromGroups(next, new Set([plan.cutterId, ...pieces.keys()]));
}

function cutMessage(plan: CutShapesPlan, selectedCount: number): string {
  const shapes = plan.cuts.length;
  const pieces = plan.cuts.reduce((sum, cut) => sum + cut.pieces.length, 0);
  const others = selectedCount - shapes - 1;
  const left =
    others <= 0
      ? ''
      : ` ${others === 1 ? '1 other selected object was' : `${others} other selected objects were`} left as ${others === 1 ? 'it was' : 'they were'}.`;
  return `Cut ${shapes === 1 ? '1 shape' : `${shapes} shapes`} into ${pieces} pieces.${left}`;
}
