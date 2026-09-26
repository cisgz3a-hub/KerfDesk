// Offset Shapes (LightBurn gap batch 3, ADR-410). The dialog's action: offset
// the selection outward, inward or both ways, add the results as new objects
// with their own operation (as the ADR-103 offset does), and optionally delete
// the originals. The whole edit is one undo step.

import { isVectorPathObject, type VectorSceneObject } from '../../core/geometry';
import { offsetShapes, type OffsetShapesOptions } from '../../core/geometry/offset-shapes';
import { addObject, type ImportedSvg, type Project, type Scene } from '../../core/scene';
import { repairDanglingObjectDependencies, reportDependencyRepairs } from './object-delete-actions';
import { removeObjectIdsFromGroups, selectedObjectIds } from './scene-group-actions';
import { pruneOrphanLayers, pushUndo, type StateSlice } from './scene-mutations';
import { useToastStore } from './toast-store';
import { prepareIndependentArtwork, uniqueObjectId } from './vector-path-actions';

export type OffsetShapesRequest = OffsetShapesOptions & {
  /** Remove the selected shapes once the offset objects exist. */
  readonly deleteOriginals: boolean;
};

export type OffsetShapesActions = {
  /** Returns true when the offset was added; false leaves the project as it was. */
  readonly offsetShapesSelection: (request: OffsetShapesRequest) => boolean;
};

type OffsetShapesState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

type OffsetShapesMutation = {
  readonly project: Project;
  readonly selectedObjectId: string;
  readonly selectedPathNode: null;
  readonly selectedPathNodes: [];
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};

type OffsetShapesSet = (
  fn: (state: OffsetShapesState) => OffsetShapesMutation | OffsetShapesState,
) => void;

export function offsetShapesActions(set: OffsetShapesSet): OffsetShapesActions {
  return {
    offsetShapesSelection: (request) => {
      let applied = false;
      set((state) => {
        const next = offsetShapesMutation(state, request);
        applied = next !== state;
        return next;
      });
      return applied;
    },
  };
}

/** The unlocked vector shapes Offset Shapes works on, in scene order. */
export function offsetShapesTargets(
  scene: Scene,
  selectedIds: ReadonlyArray<string>,
): ReadonlyArray<VectorSceneObject> {
  const selected = new Set(selectedIds);
  return scene.objects.filter(
    (object): object is VectorSceneObject =>
      selected.has(object.id) && object.locked !== true && isVectorPathObject(object),
  );
}

function offsetShapesMutation(
  state: OffsetShapesState,
  request: OffsetShapesRequest,
): OffsetShapesMutation | OffsetShapesState {
  const targets = offsetShapesTargets(state.project.scene, selectedObjectIds(state));
  const scene0 = state.project.scene;
  const result = offsetShapes(targets, request, {
    outward: uniqueObjectId(scene0, 'offset'),
    inward: uniqueObjectId(scene0, 'offset-inward'),
  });
  if (result.kind === 'error') {
    useToastStore.getState().pushToast(result.error.message, 'warning');
    return state;
  }
  const created = [result.value.outward, result.value.inward].filter(
    (object): object is ImportedSvg => object !== null,
  );
  const first = created[0];
  if (first === undefined) return state;
  if (request.direction === 'both' && result.value.inward === null) {
    useToastStore
      .getState()
      .pushToast('Only the outward offset was added: the inward one collapsed the shape.', 'info');
  }
  let scene = scene0;
  const createdIds: string[] = [];
  for (const artwork of created) {
    const prepared = prepareIndependentArtwork(scene, artwork, targets[0]);
    scene = addObject(prepared.scene, prepared.object);
    createdIds.push(prepared.object.id);
  }
  if (request.deleteOriginals) scene = removeOriginals(scene, targets);
  return {
    project: { ...state.project, scene },
    selectedObjectId: createdIds[0] ?? first.id,
    selectedPathNode: null,
    selectedPathNodes: [],
    additionalSelectedIds: new Set(createdIds.slice(1)),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function removeOriginals(scene: Scene, targets: ReadonlyArray<VectorSceneObject>): Scene {
  const ids = new Set(targets.map((object) => object.id));
  const kept: Scene = {
    ...scene,
    objects: scene.objects.filter((object) => !ids.has(object.id)),
    ...(scene.artworkOrder === undefined
      ? {}
      : { artworkOrder: scene.artworkOrder.filter((id) => !ids.has(id)) }),
  };
  const repaired = repairDanglingObjectDependencies(removeObjectIdsFromGroups(kept, ids));
  reportDependencyRepairs(repaired);
  return pruneOrphanLayers(repaired.scene);
}
