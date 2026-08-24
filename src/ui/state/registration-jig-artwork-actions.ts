import {
  addObject,
  boardFitRegion,
  combinedBBox,
  findRegistrationBoxes,
  isRegistrationBox,
  sceneObjectHasVisibleLayer,
  transformedBBox,
  type Scene,
  type SceneGroup,
  type SceneObject,
} from '../../core/scene';
import { fitSelectionToRegion } from '../../core/scene/fit-selection-to-region';
import {
  registrationJigArtworkInstances,
  registrationJigCopyId,
  registrationJigCopyPrefix,
  registrationJigGroupCopyId,
  registrationJigGroupCopyPrefix,
} from '../../core/scene/registration-jig-artwork';
import {
  buildSelectionTransformEdit,
  type SelectionTransformError,
} from '../../core/scene/selection-transform';
import type { AppState } from './store';
import { pushUndo } from './scene-mutations';

const REGISTRATION_JIG_ARTWORK_FIT_FRACTION = 0.9;

export type RegistrationJigArtworkSizeInput = {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly drivingDimension: 'width' | 'height';
};

export type RegistrationJigArtworkResizeResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'error'; readonly reason: SelectionTransformError | 'no-jig-artwork' };

export type RegistrationJigArtworkActions = {
  readonly resizeRegistrationJigArtwork: (
    input: RegistrationJigArtworkSizeInput,
  ) => RegistrationJigArtworkResizeResult;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function registrationJigArtworkActions(set: Setter): RegistrationJigArtworkActions {
  return {
    resizeRegistrationJigArtwork: (input) => {
      let outcome: RegistrationJigArtworkResizeResult = {
        kind: 'error',
        reason: 'no-jig-artwork',
      };
      set((state) => {
        const result = applyRegistrationJigArtworkSize(state, input);
        outcome = result.outcome;
        return result.state;
      });
      return outcome;
    },
  };
}

export function applyCenterArtworkInRegistrationJigSet(
  state: AppState,
): AppState | Partial<AppState> {
  const boxes = findRegistrationBoxes(state.project.scene);
  const selected = selectedArtwork(state);
  const firstBox = boxes[0];
  if (firstBox === undefined) return state;
  const fitted = fitSelectionToRegion(selected, boardFitRegion(firstBox), {
    marginFraction: REGISTRATION_JIG_ARTWORK_FIT_FRACTION,
    grow: true,
  });
  const selectionBounds = combinedBBox(fitted);
  if (selectionBounds === null) return state;

  const sourceCenter = centerOf(selectionBounds);
  const movedById = new Map<string, SceneObject>();
  const copies: SceneObject[] = [];
  const copiedGroups: SceneGroup[] = [];
  const selectionIds: string[] = [];
  for (const [boxIndex, box] of boxes.entries()) {
    const targetCenter = centerOf(transformedBBox(box));
    const delta = { x: targetCenter.x - sourceCenter.x, y: targetCenter.y - sourceCenter.y };
    if (boxIndex === 0) {
      for (const object of fitted) {
        movedById.set(object.id, translatedObject(object, object.id, delta));
        selectionIds.push(object.id);
      }
      continue;
    }
    const copiedIds = new Map<string, string>();
    for (const object of fitted) {
      const id = registrationJigCopyId(object.id, box.id);
      copiedIds.set(object.id, id);
      copies.push(translatedObject(object, id, delta));
    }
    copiedGroups.push(
      ...cloneCompleteSelectedGroups(state.project.scene, selected, copiedIds, box.id),
    );
  }

  const copyPrefixes = selected.map((object) => registrationJigCopyPrefix(object.id));
  const copiedGroupPrefixes = completeSelectedGroups(state.project.scene, selected).map((group) =>
    registrationJigGroupCopyPrefix(group.id),
  );
  let scene: Scene = {
    ...state.project.scene,
    objects: state.project.scene.objects
      .filter((object) => !copyPrefixes.some((prefix) => object.id.startsWith(prefix)))
      .map((object) => movedById.get(object.id) ?? object),
    groups: [
      ...(state.project.scene.groups ?? []).filter(
        (group) => !copiedGroupPrefixes.some((prefix) => group.id.startsWith(prefix)),
      ),
      ...copiedGroups,
    ],
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

export function applyRegistrationJigArtworkSize(
  state: AppState,
  input: RegistrationJigArtworkSizeInput,
): {
  readonly state: AppState | Partial<AppState>;
  readonly outcome: RegistrationJigArtworkResizeResult;
} {
  const scene = state.project.scene;
  const instances = registrationJigArtworkInstances(scene);
  if (instances.length === 0) {
    return { state, outcome: { kind: 'error', reason: 'no-jig-artwork' } };
  }
  const boxesById = new Map(findRegistrationBoxes(scene).map((box) => [box.id, box]));
  const movedById = new Map<string, SceneObject>();
  for (const instance of instances) {
    const resized = buildSelectionTransformEdit(instance.objects, {
      kind: 'resize',
      anchor: 'c',
      ...(input.drivingDimension === 'width'
        ? { width: input.widthMm }
        : { height: input.heightMm }),
      preserveAspect: true,
    });
    if (resized.kind === 'error') {
      return { state, outcome: resized };
    }
    const resizedObjects = instance.objects.map((object) => {
      const transform = resized.transforms.find(
        (candidate) => candidate.id === object.id,
      )?.transform;
      return transform === undefined ? object : { ...object, transform };
    });
    const bounds = combinedBBox(resizedObjects);
    const box = boxesById.get(instance.boxId);
    if (bounds === null || box === undefined) {
      return { state, outcome: { kind: 'error', reason: 'no-jig-artwork' } };
    }
    const sourceCenter = centerOf(bounds);
    const targetCenter = centerOf(transformedBBox(box));
    for (const object of resizedObjects) {
      movedById.set(
        object.id,
        translatedObject(object, object.id, {
          x: targetCenter.x - sourceCenter.x,
          y: targetCenter.y - sourceCenter.y,
        }),
      );
    }
  }
  return {
    state: {
      project: {
        ...state.project,
        scene: {
          ...scene,
          objects: scene.objects.map((object) => movedById.get(object.id) ?? object),
        },
      },
      undoStack: pushUndo(state.project, state.undoStack),
      redoStack: [],
      dirty: true,
    },
    outcome: { kind: 'ok' },
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
  boxId: string,
): ReadonlyArray<SceneGroup> {
  return completeSelectedGroups(scene, selected).map((group) => ({
    ...group,
    id: registrationJigGroupCopyId(group.id, boxId),
    objectIds: group.objectIds.flatMap((id) => {
      const copy = copiedIds.get(id);
      return copy === undefined ? [] : [copy];
    }),
  }));
}

function completeSelectedGroups(
  scene: Scene,
  selected: ReadonlyArray<SceneObject>,
): ReadonlyArray<SceneGroup> {
  const selectedIds = new Set(selected.map((object) => object.id));
  return (scene.groups ?? []).filter((group) => group.objectIds.every((id) => selectedIds.has(id)));
}

function centerOf(bounds: {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}): { readonly x: number; readonly y: number } {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}
