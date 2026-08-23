import {
  addObject,
  combinedBBox,
  findRegistrationBoxes,
  isRegistrationBox,
  sceneObjectHasVisibleLayer,
  transformedBBox,
  type Scene,
  type SceneGroup,
  type SceneObject,
} from '../../core/scene';
import type { AppState } from './store';
import { pushUndo } from './scene-mutations';

export function applyCenterArtworkInRegistrationJigSet(
  state: AppState,
  idFactory: () => string = () => crypto.randomUUID(),
): AppState | Partial<AppState> {
  const boxes = findRegistrationBoxes(state.project.scene);
  const selected = selectedArtwork(state);
  const selectionBounds = combinedBBox(selected);
  if (boxes.length === 0 || selectionBounds === null) return state;

  const sourceCenter = centerOf(selectionBounds);
  const movedById = new Map<string, SceneObject>();
  const copies: SceneObject[] = [];
  const copiedGroups: SceneGroup[] = [];
  const selectionIds: string[] = [];
  for (const [boxIndex, box] of boxes.entries()) {
    const targetCenter = centerOf(transformedBBox(box));
    const delta = { x: targetCenter.x - sourceCenter.x, y: targetCenter.y - sourceCenter.y };
    if (boxIndex === 0) {
      for (const object of selected) {
        movedById.set(object.id, translatedObject(object, object.id, delta));
        selectionIds.push(object.id);
      }
      continue;
    }
    const copiedIds = new Map<string, string>();
    for (const object of selected) {
      const id = idFactory();
      copiedIds.set(object.id, id);
      copies.push(translatedObject(object, id, delta));
      selectionIds.push(id);
    }
    copiedGroups.push(
      ...cloneCompleteSelectedGroups(state.project.scene, selected, copiedIds, idFactory),
    );
  }

  let scene: Scene = {
    ...state.project.scene,
    objects: state.project.scene.objects.map((object) => movedById.get(object.id) ?? object),
    groups: [...(state.project.scene.groups ?? []), ...copiedGroups],
  };
  for (const copy of copies) scene = addObject(scene, copy);
  const [selectedObjectId, ...additionalSelectedIds] = selectionIds;
  return {
    project: { ...state.project, scene },
    selectedObjectId: selectedObjectId ?? null,
    additionalSelectedIds: new Set(additionalSelectedIds),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function selectedArtwork(state: AppState): ReadonlyArray<SceneObject> {
  const ids = new Set([
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ]);
  return state.project.scene.objects.filter(
    (object) =>
      ids.has(object.id) &&
      !isRegistrationBox(object) &&
      object.locked !== true &&
      sceneObjectHasVisibleLayer(state.project.scene, object),
  );
}

function translatedObject(
  object: SceneObject,
  id: string,
  delta: { readonly x: number; readonly y: number },
): SceneObject {
  return {
    ...object,
    id,
    transform: {
      ...object.transform,
      x: object.transform.x + delta.x,
      y: object.transform.y + delta.y,
    },
  };
}

function cloneCompleteSelectedGroups(
  scene: Scene,
  selected: ReadonlyArray<SceneObject>,
  copiedIds: ReadonlyMap<string, string>,
  idFactory: () => string,
): ReadonlyArray<SceneGroup> {
  const selectedIds = new Set(selected.map((object) => object.id));
  return (scene.groups ?? []).flatMap((group) => {
    if (!group.objectIds.every((id) => selectedIds.has(id))) return [];
    return [
      {
        ...group,
        id: idFactory(),
        objectIds: group.objectIds.flatMap((id) => {
          const copy = copiedIds.get(id);
          return copy === undefined ? [] : [copy];
        }),
      },
    ];
  });
}

function centerOf(bounds: {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}): { readonly x: number; readonly y: number } {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}
