import {
  arrayPlacements,
  combinedBBox,
  sceneObjectHasVisibleLayer,
  type ArraySpec,
  type SceneGroup,
  type SceneObject,
} from '../../core/scene';
import { copyObjectsAtArrayPlacement } from './array-selection-copies';
import { planArrayFirstPlacement } from './array-first-placement';
import { sceneObjectCopyClosure } from './scene-object-copy-dependencies';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

export { placedObject } from './array-selection-copies';

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

  const copySources = sceneObjectCopyClosure(state.project.scene.objects, selectedIds);
  const copySourceIds = new Set(copySources.map((object) => object.id));
  const firstPlan = planArrayFirstPlacement(
    state.project.scene.objects,
    state.project.scene.groups ?? [],
    selected,
    copySources,
    first,
    idFactory,
  );
  const copies: SceneObject[] = [...firstPlan.copiedObjects];
  const copiedSelectedIds: string[] = [];
  const copiedGroups: SceneGroup[] = cloneSelectedGroups(
    state.project.scene.groups ?? [],
    firstPlan.protectedSourceIds,
    firstPlan.copiedIds,
    idFactory,
  );
  for (const placement of placements.slice(1)) {
    const copied = copyObjectsAtArrayPlacement(copySources, placement, idFactory);
    const ids = copied.ids;
    copies.push(...copied.objects);
    copiedSelectedIds.push(
      ...selected.flatMap((object) => {
        const id = ids.get(object.id);
        return id === undefined ? [] : [id];
      }),
    );
    copiedGroups.push(
      ...cloneSelectedGroups(state.project.scene.groups ?? [], copySourceIds, ids, idFactory),
    );
  }
  const objects = state.project.scene.objects
    .map((object) => firstPlan.movedById.get(object.id) ?? object)
    .concat(copies);
  const selectedResultIds = [...firstPlan.selectedObjectIds, ...copiedSelectedIds];
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
