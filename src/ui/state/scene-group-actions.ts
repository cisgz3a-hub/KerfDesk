import { designHierarchyActions, type DesignHierarchyActions } from './design-hierarchy-actions';
import { currentHierarchyFocus, groupsWithinFocus } from './design-hierarchy-store';
import { promoteGroupParents, pruneSceneGroups } from './prune-scene-groups';
import { sceneObjectHasVisibleLayer, type Scene, type SceneGroup } from '../../core/scene';
import { pushUndo } from './scene-mutations';
import { carriedSelectionReference } from './selection-reference';
import { pruneDesignTreeOrder } from '../../core/scene/design-hierarchy-order';
import type { AppState } from './store';

const MIN_GROUP_MEMBERS = 2;

export type SceneGroupActions = DesignHierarchyActions & {
  readonly groupSelection: () => void;
  readonly ungroupSelection: () => void;
};

type SelectionState = Pick<AppState, 'selectedObjectId' | 'additionalSelectedIds'>;
type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function sceneGroupActions(set: Setter): SceneGroupActions {
  return {
    ...designHierarchyActions(set),
    groupSelection: () => set((state) => groupSelectionInState(state)),
    ungroupSelection: () => set((state) => ungroupSelectionInState(state)),
  };
}

export function selectionFromIds(
  state: Pick<AppState, 'project' | 'selectedObjectId' | 'additionalSelectedIds'> &
    Partial<Pick<AppState, 'projectDocumentEpoch'>>,
  ids: ReadonlyArray<string>,
  additive: boolean,
): SelectionState {
  const current = additive ? currentSelectionIds(state) : [];
  return selectionStateFromIds(
    state.project.scene,
    [...current, ...ids],
    currentHierarchyFocus(state.project.scene, state.projectDocumentEpoch),
  );
}

export function toggleSelectionFromId(
  state: Pick<AppState, 'project' | 'selectedObjectId' | 'additionalSelectedIds'> &
    Partial<Pick<AppState, 'projectDocumentEpoch'>>,
  id: string,
): SelectionState {
  const expanded = expandedObjectIdsForGroups(
    state.project.scene,
    [id],
    currentHierarchyFocus(state.project.scene, state.projectDocumentEpoch),
  );
  const current = currentSelectionIds(state);
  const currentSet = new Set(current);
  const remove = expanded.length > 0 && expanded.every((expandedId) => currentSet.has(expandedId));
  const nextIds = remove
    ? current.filter((currentId) => !expanded.includes(currentId))
    : [...current, ...expanded];
  return selectionStateFromIds(
    state.project.scene,
    nextIds,
    currentHierarchyFocus(state.project.scene, state.projectDocumentEpoch),
  );
}

export function selectedObjectIds(
  state: Pick<AppState, 'selectedObjectId' | 'additionalSelectedIds'>,
): ReadonlyArray<string> {
  return currentSelectionIds(state);
}

export function removeObjectIdsFromGroups(scene: Scene, ids: ReadonlySet<string>): Scene {
  const groups = pruneGroups(
    (scene.groups ?? []).map((group) => ({
      ...group,
      objectIds: group.objectIds.filter((id) => !ids.has(id)),
    })),
    scene,
  );
  return pruneDesignTreeOrder(groups === (scene.groups ?? []) ? scene : { ...scene, groups });
}

function groupSelectionInState(state: AppState): AppState | Partial<AppState> {
  const focus = currentHierarchyFocus(state.project.scene, state.projectDocumentEpoch);
  const objectIds = expandedObjectIdsForGroups(
    state.project.scene,
    currentSelectionIds(state),
    focus,
  );
  if (objectIds.length < MIN_GROUP_MEMBERS) return state;
  const selectedSet = new Set(objectIds);
  const groups = state.project.scene.groups ?? [];
  const complete = groupsWithinFocus(groups, focus).filter((group) =>
    group.objectIds.every((id) => selectedSet.has(id)),
  );
  const completeIds = new Set(complete.map((group) => group.id));
  const group: SceneGroup = {
    id: crypto.randomUUID(),
    name: nextGroupName(groups),
    objectIds,
    ...(focus === null ? {} : { parentId: focus }),
  };
  const keptGroups = groups.map((existing) =>
    completeIds.has(existing.id) &&
    (existing.parentId === undefined || !completeIds.has(existing.parentId))
      ? { ...existing, parentId: group.id }
      : existing,
  );
  const selection = selectionStateFromIds(state.project.scene, objectIds, focus);
  return {
    project: {
      ...state.project,
      scene: { ...state.project.scene, groups: [...keptGroups, group] },
    },
    ...selection,
    selectionReference: carriedSelectionReference(state, selection),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function ungroupSelectionInState(state: AppState): AppState | Partial<AppState> {
  const focus = currentHierarchyFocus(state.project.scene, state.projectDocumentEpoch);
  const selected = expandedObjectIdsForGroups(
    state.project.scene,
    currentSelectionIds(state),
    focus,
  );
  if (selected.length === 0) return state;
  const selectedSet = new Set(selected);
  const groups = state.project.scene.groups ?? [];
  const touched = groupsWithinFocus(groups, focus).filter((group) =>
    group.objectIds.some((id) => selectedSet.has(id)),
  );
  const touchedIds = new Set(touched.map((group) => group.id));
  const removed = new Set(
    touched
      .filter((group) => group.parentId === undefined || !touchedIds.has(group.parentId))
      .map((group) => group.id),
  );
  const kept = promoteGroupParents(
    groups.filter((group) => !removed.has(group.id)),
    new Map(groups.map((group) => [group.id, group])),
  );
  if (removed.size === 0) return state;
  const selection = selectionStateFromIds(state.project.scene, selected, focus);
  return {
    project: {
      ...state.project,
      scene: pruneDesignTreeOrder({ ...state.project.scene, groups: kept }),
    },
    ...selection,
    selectionReference: carriedSelectionReference(state, selection),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function selectionStateFromIds(
  scene: Scene,
  ids: ReadonlyArray<string>,
  focus: string | null = null,
): SelectionState {
  const [primary, ...rest] = expandedObjectIdsForGroups(scene, ids, focus);
  return {
    selectedObjectId: primary ?? null,
    additionalSelectedIds: new Set(rest),
  };
}

function expandedObjectIdsForGroups(
  scene: Scene,
  ids: ReadonlyArray<string>,
  focus: string | null = null,
): ReadonlyArray<string> {
  const selected = new Set(ids);
  const groupsByMember = new Map<string, SceneGroup[]>();
  for (const group of groupsWithinFocus(scene.groups ?? [], focus)) {
    for (const id of group.objectIds) {
      const memberships = groupsByMember.get(id) ?? [];
      memberships.push(group);
      groupsByMember.set(id, memberships);
    }
  }
  const pending = [...selected];
  const expandedGroups = new Set<SceneGroup>();
  for (const id of pending) {
    for (const group of groupsByMember.get(id) ?? []) {
      if (expandedGroups.has(group)) continue;
      expandedGroups.add(group);
      for (const memberId of group.objectIds) {
        if (selected.has(memberId)) continue;
        selected.add(memberId);
        pending.push(memberId);
      }
    }
  }
  return orderedLiveIds(scene, selected, focus);
}

function orderedLiveIds(
  scene: Scene,
  ids: ReadonlySet<string>,
  focus: string | null,
): ReadonlyArray<string> {
  const scope =
    focus === null
      ? null
      : new Set(scene.groups?.find((group) => group.id === focus)?.objectIds ?? []);
  const out: string[] = [];
  for (const object of scene.objects) {
    if (object.locked === true) continue;
    if (!sceneObjectHasVisibleLayer(scene, object)) continue;
    if (ids.has(object.id) && (scope === null || scope.has(object.id))) out.push(object.id);
  }
  return out;
}

function pruneGroups(groups: ReadonlyArray<SceneGroup>, scene: Scene): ReadonlyArray<SceneGroup> {
  return pruneSceneGroups(groups, new Set(scene.objects.map((object) => object.id)));
}

function currentSelectionIds(
  state: Pick<AppState, 'selectedObjectId' | 'additionalSelectedIds'>,
): ReadonlyArray<string> {
  return [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ];
}

function nextGroupName(groups: ReadonlyArray<SceneGroup>): string {
  return `Group ${groups.length + 1}`;
}
