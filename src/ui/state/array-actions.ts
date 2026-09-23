import {
  arrayPlacements,
  combinedBBox,
  sceneObjectHasVisibleLayer,
  type ArraySpec,
  type Bounds,
  type Project,
  type SceneGroup,
  type SceneObject,
} from '../../core/scene';
import { copyObjectsAtArrayPlacement } from './array-selection-copies';
import { planArrayFirstPlacement } from './array-first-placement';
import { sceneObjectCopyClosure } from './scene-object-copy-dependencies';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

export { placedObject } from './array-selection-copies';

export type ArrayMaterialization = {
  readonly bounds: Bounds;
  readonly sources: ReadonlyArray<ReadonlyArray<SceneObject>>;
};
export type ArrayActions = {
  readonly arraySelection: (
    spec: ArraySpec,
    materialized?: ArrayMaterialization,
    expectedProject?: Project,
  ) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function arrayActions(set: Setter): ArrayActions {
  return {
    arraySelection: (spec, materialized, expectedProject) =>
      set((state) =>
        expectedProject !== undefined && state.project !== expectedProject
          ? {}
          : applyArraySelection(state, spec, undefined, materialized),
      ),
  };
}

export function applyArraySelection(
  state: AppState,
  spec: ArraySpec,
  idFactory: () => string = () => crypto.randomUUID(),
  materialized?: ArrayMaterialization,
): AppState | Partial<AppState> {
  const selection = arraySourceSelection(state, materialized);
  if (selection === null) return state;
  const { selectedIds, sourceObjects, selected, bounds } = selection;
  const placements = arrayPlacements(bounds, spec);
  const first = placements[0];
  if (first === undefined) return state;

  const copySources = sceneObjectCopyClosure(sourceObjects, selectedIds);
  const copySourceIds = new Set(copySources.map((object) => object.id));
  const groups = state.project.scene.groups ?? [];
  const firstPlan = planArrayFirstPlacement(
    sourceObjects,
    groups,
    selected,
    copySources,
    first,
    idFactory,
  );
  const copies: SceneObject[] = [...firstPlan.copiedObjects];
  const copiedSelectedIds: string[] = [];
  const copiedGroups: SceneGroup[] = cloneSelectedGroups(
    groups,
    firstPlan.protectedSourceIds,
    firstPlan.copiedIds,
    idFactory,
  );
  for (let index = 1; index < placements.length; index += 1) {
    const placement = placements[index];
    if (placement === undefined) continue;
    const copied = copyObjectsAtArrayPlacement(
      materialized?.sources[index] ?? copySources,
      placement,
      idFactory,
    );
    const ids = copied.ids;
    copies.push(...copied.objects);
    copiedSelectedIds.push(
      ...selected.flatMap((object) => {
        const id = ids.get(object.id);
        return id === undefined ? [] : [id];
      }),
    );
    copiedGroups.push(...cloneSelectedGroups(groups, copySourceIds, ids, idFactory));
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
        groups: [...groups, ...copiedGroups],
      },
    },
    selectedObjectId: selectedResultIds[0] ?? null,
    additionalSelectedIds: new Set(selectedResultIds.slice(1)),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function arraySourceSelection(state: AppState, materialized: ArrayMaterialization | undefined) {
  const selectedIds = selectionIds(state);
  const firstSources = new Map(materialized?.sources[0]?.map((object) => [object.id, object]));
  const sourceObjects = state.project.scene.objects.map(
    (object) => firstSources.get(object.id) ?? object,
  );
  const selected = sourceObjects.filter((object) => selectedIds.has(object.id));
  if (
    selected.length === 0 ||
    selected.some(
      (object) =>
        object.locked === true || !sceneObjectHasVisibleLayer(state.project.scene, object),
    )
  )
    return null;
  const bounds = materialized?.bounds ?? combinedBBox(selected);
  return bounds === null ? null : { selectedIds, sourceObjects, selected, bounds };
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
