import {
  arrayPlacements,
  combinedBBox,
  sceneObjectHasVisibleLayer,
  type ArrayPlacement,
  type ArraySpec,
  type Bounds,
  type Project,
  type Scene,
  type SceneGroup,
  type SceneObject,
} from '../../core/scene';
import { arrayPlacementCount } from '../../core/scene/array-layout';
import {
  arrayAsk,
  arrayCopiedIds,
  arrayRoomProblem,
  FEWER_COPIES,
  FEWER_PIECES,
} from './array-room';
import { copyObjectsAtArrayPlacement } from './array-selection-copies';
import { planArrayFirstPlacement, type ArrayFirstPlacementPlan } from './array-first-placement';
import { copiesThatFit, sceneLimitOverrun } from './scene-copy-room';
import { sceneObjectCopyClosure } from './scene-object-copy-dependencies';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { useToastStore } from './toast-store';

export { placedObject } from './array-selection-copies';

export type ArrayMaterialization = {
  readonly bounds: Bounds;
  readonly sources: ReadonlyArray<ReadonlyArray<SceneObject>>;
  readonly placements?: ReadonlyArray<ArrayPlacement>;
};
export type ArrayActions = {
  readonly arraySelection: (
    spec: ArraySpec,
    materialized?: ArrayMaterialization,
    expectedProject?: Project,
  ) => void;
  /**
   * The selection repeated at explicit placements (ADR-442 find pieces and
   * fill): placement 0 moves the selection itself, each later one adds a copy.
   * One undo step, like an array. Returns true when they were placed; a project
   * without room for them is left as it was, with a notice (ADR-307 amendment 1).
   */
  readonly placeSelectionCopies: (
    placements: ReadonlyArray<ArrayPlacement>,
    expectedProject?: Project,
  ) => boolean;
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
    placeSelectionCopies: (placements, expectedProject) => {
      let placed = false;
      set((state) => {
        if (expectedProject !== undefined && state.project !== expectedProject) return {};
        const next = applySelectionPlacements(state, () => placements, undefined, {
          instances: placements.length,
          ask: FEWER_PIECES,
        });
        placed = next !== state;
        return next;
      });
      return placed;
    },
  };
}

export function applyArraySelection(
  state: AppState,
  spec: ArraySpec,
  idFactory: () => string = () => crypto.randomUUID(),
  materialized?: ArrayMaterialization,
): AppState | Partial<AppState> {
  return applySelectionPlacements(
    state,
    (bounds) => materialized?.placements ?? arrayPlacements(bounds, spec),
    idFactory,
    {
      materialized,
      sourceIds: arraySelectionIds(state, spec),
      instances: arrayPlacementCount(spec),
      ask: arrayAsk(spec),
    },
  );
}

/**
 * The objects an array repeats: the selection, less the object a circular
 * array is centred on, which stays where it is (LightBurn gap LBG-T14).
 */
export function arraySelectionIds(
  state: Pick<AppState, 'selectedObjectId' | 'additionalSelectedIds'>,
  spec: ArraySpec,
): ReadonlySet<string> {
  return arrayCopiedIds(
    selectionIds(state),
    spec.kind === 'circular' ? spec.centerObjectId : undefined,
  );
}

/** What a placement request says beyond where the copies go. */
export type PlacementRequest = {
  /** Variable copies already rendered: each instance's own objects. */
  readonly materialized?: ArrayMaterialization | undefined;
  /** What is copied; the selection when absent. */
  readonly sourceIds?: ReadonlySet<string>;
  /**
   * How many instances the placements will hold, the original included, when
   * that is known without laying them out: a request the project has no room
   * for is then refused before any placement is made, however many it asks for.
   */
  readonly instances?: number;
  /** What to change to ask for fewer instances; used in that refusal. */
  readonly ask?: string;
};

/**
 * The selection moved to the first placement and copied to every later one.
 * Refused, with a notice, when the project could not hold the result: a
 * project over PROJECT_SCENE_LIMITS cannot be reopened (ADR-307 amendment 1).
 */
export function applySelectionPlacements(
  state: AppState,
  placementsFor: (bounds: Bounds) => ReadonlyArray<ArrayPlacement>,
  idFactory: () => string = () => crypto.randomUUID(),
  request: PlacementRequest = {},
): AppState | Partial<AppState> {
  const { materialized } = request;
  const selection = arraySourceSelection(
    state,
    materialized,
    request.sourceIds ?? selectionIds(state),
  );
  if (selection === null) return state;
  const { selectedIds, sourceObjects, selected, bounds } = selection;
  const copySources = sceneObjectCopyClosure(sourceObjects, selectedIds);
  const tooMany = roomProblem(state.project.scene, copySources.length, request);
  if (tooMany !== null) return refused(state, tooMany);
  const placements = placementsFor(bounds);
  const first = placements[0];
  if (first === undefined) return state;

  const groups = state.project.scene.groups ?? [];
  const firstPlan = planArrayFirstPlacement(
    sourceObjects,
    groups,
    selected,
    copySources,
    first,
    idFactory,
  );
  const firstGroups = cloneSelectedGroups(
    groups,
    firstPlan.protectedSourceIds,
    firstPlan.copiedIds,
    idFactory,
  );
  const later = laterCopies({ selected, copySources, groups, materialized, idFactory }, placements);
  const scene: Scene = {
    ...state.project.scene,
    objects: placedObjects(state.project.scene, firstPlan).concat(later.objects),
    groups: [...groups, ...firstGroups, ...later.groups],
  };
  const overrun = sceneLimitOverrun(state.project.scene, scene);
  if (overrun !== null) return refused(state, overrun);
  const selectedResultIds = [...firstPlan.selectedObjectIds, ...later.selectedIds];
  return {
    project: { ...state.project, scene },
    selectedObjectId: selectedResultIds[0] ?? null,
    additionalSelectedIds: new Set(selectedResultIds.slice(1)),
    undoStack: pushUndo(state.project, state.undoStack, 'Array'),
    redoStack: [],
    dirty: true,
  };
}

// A count known up front is set against the room before anything is laid out.
// The room counts objects only; sceneLimitOverrun is the exact check afterwards.
function roomProblem(scene: Scene, perCopy: number, request: PlacementRequest): string | null {
  if (request.instances === undefined) return null;
  const room = copiesThatFit(scene.objects.length, perCopy);
  return arrayRoomProblem(room, request.instances, request.ask ?? FEWER_COPIES);
}

function refused(state: AppState, message: string): AppState {
  useToastStore.getState().pushToast(message, 'warning');
  return state;
}

// The scene's objects with the first placement's moves applied, and its copies
// of anything that could not move, added.
function placedObjects(scene: Scene, firstPlan: ArrayFirstPlacementPlan): SceneObject[] {
  return scene.objects
    .map((object) => firstPlan.movedById.get(object.id) ?? object)
    .concat(firstPlan.copiedObjects);
}

type Copying = {
  readonly selected: ReadonlyArray<SceneObject>;
  readonly copySources: ReadonlyArray<SceneObject>;
  readonly groups: ReadonlyArray<SceneGroup>;
  readonly materialized: ArrayMaterialization | undefined;
  readonly idFactory: () => string;
};

// Every placement after the first adds a copy of the selection and of the
// groups that travel whole with it.
function laterCopies(
  copying: Copying,
  placements: ReadonlyArray<ArrayPlacement>,
): {
  readonly objects: SceneObject[];
  readonly selectedIds: string[];
  readonly groups: SceneGroup[];
} {
  const { selected, copySources, groups, materialized, idFactory } = copying;
  const copySourceIds = new Set(copySources.map((object) => object.id));
  const objects: SceneObject[] = [];
  const selectedIds: string[] = [];
  const copiedGroups: SceneGroup[] = [];
  for (let index = 1; index < placements.length; index += 1) {
    const placement = placements[index];
    if (placement === undefined) continue;
    const copied = copyObjectsAtArrayPlacement(
      materialized?.sources[index] ?? copySources,
      placement,
      idFactory,
    );
    objects.push(...copied.objects);
    selectedIds.push(
      ...selected.flatMap((object) => {
        const id = copied.ids.get(object.id);
        return id === undefined ? [] : [id];
      }),
    );
    copiedGroups.push(...cloneSelectedGroups(groups, copySourceIds, copied.ids, idFactory));
  }
  return { objects, selectedIds, groups: copiedGroups };
}

function arraySourceSelection(
  state: AppState,
  materialized: ArrayMaterialization | undefined,
  selectedIds: ReadonlySet<string>,
) {
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

function selectionIds(
  state: Pick<AppState, 'selectedObjectId' | 'additionalSelectedIds'>,
): ReadonlySet<string> {
  return new Set([
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ]);
}

/** New groups for a copy: one per source group that travelled with it whole. */
export function cloneSelectedGroups(
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
