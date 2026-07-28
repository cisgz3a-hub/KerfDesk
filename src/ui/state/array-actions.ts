import {
  arrayPlacements,
  combinedBBox,
  sceneObjectHasVisibleLayer,
  type ArrayPlacement,
  type ArraySpec,
  type SceneGroup,
  type SceneObject,
} from '../../core/scene';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

export type ArrayActions = { readonly arraySelection: (spec: ArraySpec) => void };

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function arrayActions(set: Setter): ArrayActions {
  return { arraySelection: (spec) => set((state) => applyArraySelection(state, spec)) };
}

export function applyArraySelection(
  state: AppState,
  spec: ArraySpec,
  idFactory: () => string = () => crypto.randomUUID(),
): AppState | Partial<AppState> {
  const selectedIds = selectionIds(state);
  const selected = state.project.scene.objects.filter((object) => selectedIds.has(object.id));
  if (
    selected.length === 0 ||
    selected.some(
      (object) =>
        object.locked === true || !sceneObjectHasVisibleLayer(state.project.scene, object),
    )
  ) {
    return state;
  }
  const bounds = combinedBBox(selected);
  if (bounds === null) return state;
  const placements = arrayPlacements(bounds, spec);
  const first = placements[0];
  if (first === undefined) return state;

  const moved = new Map(selected.map((object) => [object.id, placedObject(object, first)]));
  const copies: SceneObject[] = [];
  const copiedGroups: SceneGroup[] = [];
  for (const placement of placements.slice(1)) {
    const ids = new Map<string, string>();
    for (const object of selected) {
      const id = idFactory();
      ids.set(object.id, id);
      copies.push({ ...placedObject(object, placement), id } as SceneObject);
    }
    copiedGroups.push(
      ...cloneSelectedGroups(state.project.scene.groups ?? [], selectedIds, ids, idFactory),
    );
  }
  const objects = state.project.scene.objects
    .map((object) => moved.get(object.id) ?? object)
    .concat(copies);
  const selectedResultIds = [
    ...selected.map((object) => object.id),
    ...copies.map((copy) => copy.id),
  ];
  return {
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects,
        groups: [...(state.project.scene.groups ?? []), ...copiedGroups],
      },
    },
    selectedObjectId: selectedResultIds[0] ?? null,
    additionalSelectedIds: new Set(selectedResultIds.slice(1)),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function selectionIds(state: AppState): ReadonlySet<string> {
  return new Set([
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ]);
}

/** Pure placement of one array copy. Exported for direct pivot coverage. */
export function placedObject(object: SceneObject, placement: ArrayPlacement): SceneObject {
  const moved = {
    ...object.transform,
    x: object.transform.x + placement.dx,
    y: object.transform.y + placement.dy,
  };
  // A rotated copy must SPIN about the ring point dx/dy just centred it on.
  // applyTransform rotates about the object's local origin, so adding
  // rotationDeg alone swings the copy off the ring; rotate its origin about the
  // pivot to keep the copy centred there.
  if (placement.rotationDeg === 0 || placement.pivot === undefined) {
    return { ...object, transform: moved } as SceneObject;
  }
  const origin = rotateAboutPivot(moved, placement.pivot, placement.rotationDeg);
  return {
    ...object,
    transform: {
      ...moved,
      x: origin.x,
      y: origin.y,
      rotationDeg: normalizeDegrees(object.transform.rotationDeg + placement.rotationDeg),
    },
  } as SceneObject;
}

function rotateAboutPivot(
  origin: { readonly x: number; readonly y: number },
  pivot: { readonly x: number; readonly y: number },
  deltaDeg: number,
): { readonly x: number; readonly y: number } {
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = origin.x - pivot.x;
  const dy = origin.y - pivot.y;
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
}

function cloneSelectedGroups(
  groups: ReadonlyArray<SceneGroup>,
  selectedIds: ReadonlySet<string>,
  copiedIds: ReadonlyMap<string, string>,
  idFactory: () => string,
): SceneGroup[] {
  return groups.flatMap((group) => {
    if (!group.objectIds.every((id) => selectedIds.has(id))) return [];
    const objectIds = group.objectIds.flatMap((id) => {
      const copy = copiedIds.get(id);
      return copy === undefined ? [] : [copy];
    });
    return objectIds.length < 2 ? [] : [{ ...group, id: idFactory(), objectIds }];
  });
}

function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}
