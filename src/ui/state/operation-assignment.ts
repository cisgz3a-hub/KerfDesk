// Moving artwork onto an existing operation: the operation rows' Move
// selection here, a row's colour swatch (LightBurn's palette move) and the
// inspector's Move to operation. The artwork is bound to exactly that
// operation. Its artwork-wide overrides (a trace's fill style, say) keep
// applying there; settings it held for an operation it leaves stay with that
// operation. An operation this move leaves without artwork is removed, and so
// are the settings any artwork held for it, which a saved project must not
// reference.

import {
  bindSceneObjectToOperations,
  isRegistrationBox,
  isRegistrationLayer,
  operationIdsForObject,
  type Project,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { pruneSceneObjectOperationOverrides } from '../../core/scene/operation-binding';
import { pushUndo, type StateSlice } from './scene-mutations';
import { selectionWithoutHidden } from './visible-selection';

type AssignmentState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

/** A store update of one undo step that may also trim the selection. */
export type UndoableUpdate = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
  readonly selectedObjectId?: string | null;
  readonly additionalSelectedIds?: ReadonlySet<string>;
};

/** The store update for the move, one undo step, or none when nothing moves.
 * Artwork moved onto a hidden operation disappears from the canvas, so it
 * also leaves the selection. */
export function assignmentUpdate(
  state: AssignmentState,
  objectIds: ReadonlySet<string>,
  operationId: string,
): UndoableUpdate | Record<string, never> {
  const scene = assignObjectsToOperation(state.project.scene, objectIds, operationId);
  if (scene === state.project.scene) return {};
  return {
    project: { ...state.project, scene },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
    ...selectionWithoutHidden(state, scene),
  };
}

/** The scene with `objectIds` moved onto `operationId`, or the same scene when
 * nothing changes. Locked artwork and the registration jig never move, and the
 * reserved jig operation never receives artwork. */
export function assignObjectsToOperation(
  scene: Scene,
  objectIds: ReadonlySet<string>,
  operationId: string,
): Scene {
  const target = scene.layers.find((layer) => layer.id === operationId);
  if (target === undefined || isRegistrationLayer(target)) return scene;
  let changed = false;
  const objects = scene.objects.map((object) => {
    if (!objectIds.has(object.id) || !canMove(object) || usesOnly(object, scene, operationId)) {
      return object;
    }
    changed = true;
    return bindSceneObjectToOperations(object, [operationId]);
  });
  if (!changed) return scene;
  const usedBefore = usedOperationIds(scene);
  const moved: Scene = { ...scene, objects };
  const usedAfter = usedOperationIds(moved);
  const layers = scene.layers.filter(
    (layer) => usedAfter.has(layer.id) || !usedBefore.has(layer.id),
  );
  return {
    ...moved,
    layers,
    objects: pruneSceneObjectOperationOverrides(objects, layers),
  };
}

/** True when this artwork already runs on `operationId` and nothing else, so
 * moving it there would change nothing. */
export function usesOnly(object: SceneObject, scene: Scene, operationId: string): boolean {
  const ids = operationIdsForObject(object, scene.layers);
  return ids.length === 1 && ids[0] === operationId;
}

export function canMove(object: SceneObject): boolean {
  return object.locked !== true && !isRegistrationBox(object);
}

function usedOperationIds(scene: Scene): ReadonlySet<string> {
  return new Set(scene.objects.flatMap((object) => operationIdsForObject(object, scene.layers)));
}
