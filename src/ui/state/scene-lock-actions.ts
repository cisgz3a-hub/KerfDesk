import type { Project, SceneObject } from '../../core/scene';
import { pushUndo } from './scene-mutations';
import { selectedObjectIds } from './scene-group-actions';
import type { AppState } from './store';

export type SceneLockActions = {
  readonly lockSelection: () => void;
  readonly unlockAllObjects: () => void;
  /** Unlocks just these objects, as one undo step (annoyance audit A4-P2-3). */
  readonly unlockObjects: (ids: ReadonlyArray<string>) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function sceneLockActions(set: Setter): SceneLockActions {
  return {
    lockSelection: () => set((state) => lockSelectionInState(state)),
    unlockAllObjects: () => set((state) => unlockAllObjectsInState(state)),
    unlockObjects: (ids) => set((state) => unlockObjectsInState(state, ids)),
  };
}

function lockSelectionInState(state: AppState): AppState | Partial<AppState> {
  const ids = new Set(selectedObjectIds(state));
  if (ids.size === 0) return state;
  const nextProject = mapObjects(state.project, (object) => {
    if (!ids.has(object.id) || object.locked === true) return object;
    return { ...object, locked: true };
  });
  if (nextProject === state.project) return state;
  return {
    project: nextProject,
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function unlockAllObjectsInState(state: AppState): AppState | Partial<AppState> {
  const nextProject = mapObjects(state.project, (object) =>
    object.locked === true ? unlockedObject(object) : object,
  );
  if (nextProject === state.project) return state;
  return {
    project: nextProject,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function unlockObjectsInState(
  state: AppState,
  ids: ReadonlyArray<string>,
): AppState | Partial<AppState> {
  const wanted = new Set(ids);
  if (wanted.size === 0) return state;
  const nextProject = mapObjects(state.project, (object) =>
    wanted.has(object.id) && object.locked === true ? unlockedObject(object) : object,
  );
  if (nextProject === state.project) return state;
  return {
    project: nextProject,
    undoStack: pushUndo(state.project, state.undoStack, 'Unlock'),
    redoStack: [],
    dirty: true,
  };
}

function mapObjects(project: Project, map: (object: SceneObject) => SceneObject): Project {
  let changed = false;
  const objects = project.scene.objects.map((object) => {
    const next = map(object);
    if (next !== object) changed = true;
    return next;
  });
  return changed ? { ...project, scene: { ...project.scene, objects } } : project;
}

function unlockedObject(object: SceneObject): SceneObject {
  const { locked: _locked, ...rest } = object;
  return rest as SceneObject;
}
