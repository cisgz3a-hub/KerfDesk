import { sceneObjectHasVisibleLayer, type Scene, type SceneGroup } from '../../core/scene';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

const MIN_GROUP_MEMBERS = 2;

export type SceneGroupActions = {
  readonly groupSelection: () => void;
  readonly ungroupSelection: () => void;
};

type SelectionState = Pick<AppState, 'selectedObjectId' | 'additionalSelectedIds'>;
type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function sceneGroupActions(set: Setter): SceneGroupActions {
  return {
    groupSelection: () => set((state) => groupSelectionInState(state)),
    ungroupSelection: () => set((state) => ungroupSelectionInState(state)),
  };
}

export function selectionFromIds(
  state: Pick<AppState, 'project' | 'selectedObjectId' | 'additionalSelectedIds'>,
  ids: ReadonlyArray<string>,
  additive: boolean,
): SelectionState {
  const current = additive ? currentSelectionIds(state) : [];
  return selectionStateFromIds(state.project.scene, [...current, ...ids]);
}

export function toggleSelectionFromId(
  state: Pick<AppState, 'project' | 'selectedObjectId' | 'additionalSelectedIds'>,
  id: string,
): SelectionState {
  const expanded = expandedObjectIdsForGroups(state.project.scene, [id]);
  const current = currentSelectionIds(state);
  const currentSet = new Set(current);
  const remove = expanded.length > 0 && expanded.every((expandedId) => currentSet.has(expandedId));
  const nextIds = remove
    ? current.filter((currentId) => !expanded.includes(currentId))
    : [...current, ...expanded];
  return selectionStateFromIds(state.project.scene, nextIds);
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
  return groups === (scene.groups ?? []) ? scene : { ...scene, groups };
}

function groupSelectionInState(state: AppState): AppState | Partial<AppState> {
  const objectIds = expandedObjectIdsForGroups(state.project.scene, currentSelectionIds(state));
  if (objectIds.length < MIN_GROUP_MEMBERS) return state;
  const selectedSet = new Set(objectIds);
  const keptGroups = pruneGroups(
    (state.project.scene.groups ?? []).map((group) => ({
      ...group,
      objectIds: group.objectIds.filter((id) => !selectedSet.has(id)),
    })),
    state.project.scene,
  );
  const group: SceneGroup = {
    id: crypto.randomUUID(),
    name: nextGroupName(state.project.scene.groups ?? []),
    objectIds,
  };
  return {
    project: {
      ...state.project,
      scene: { ...state.project.scene, groups: [...keptGroups, group] },
    },
    ...selectionStateFromIds(state.project.scene, objectIds),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function ungroupSelectionInState(state: AppState): AppState | Partial<AppState> {
  const selected = expandedObjectIdsForGroups(state.project.scene, currentSelectionIds(state));
  if (selected.length === 0) return state;
  const selectedSet = new Set(selected);
  const groups = state.project.scene.groups ?? [];
  const kept = groups.filter((group) => !group.objectIds.some((id) => selectedSet.has(id)));
  if (kept.length === groups.length) return state;
  return {
    project: { ...state.project, scene: { ...state.project.scene, groups: kept } },
    ...selectionStateFromIds(state.project.scene, selected),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function selectionStateFromIds(scene: Scene, ids: ReadonlyArray<string>): SelectionState {
  const [primary, ...rest] = expandedObjectIdsForGroups(scene, ids);
  return {
    selectedObjectId: primary ?? null,
    additionalSelectedIds: new Set(rest),
  };
}

function expandedObjectIdsForGroups(
  scene: Scene,
  ids: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const selected = new Set(ids);
  for (const group of scene.groups ?? []) {
    if (group.objectIds.some((id) => selected.has(id))) {
      for (const id of group.objectIds) selected.add(id);
    }
  }
  return orderedLiveIds(scene, selected);
}

function orderedLiveIds(scene: Scene, ids: ReadonlySet<string>): ReadonlyArray<string> {
  const out: string[] = [];
  for (const object of scene.objects) {
    if (object.locked === true) continue;
    if (!sceneObjectHasVisibleLayer(scene, object)) continue;
    if (ids.has(object.id)) out.push(object.id);
  }
  return out;
}

function pruneGroups(groups: ReadonlyArray<SceneGroup>, scene: Scene): ReadonlyArray<SceneGroup> {
  const live = new Set(scene.objects.map((object) => object.id));
  return groups
    .map((group) => ({
      ...group,
      objectIds: group.objectIds.filter((id) => live.has(id)),
    }))
    .filter((group) => group.objectIds.length >= MIN_GROUP_MEMBERS);
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
