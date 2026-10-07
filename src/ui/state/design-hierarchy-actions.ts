import { sceneObjectHasVisibleLayer, type Scene } from '../../core/scene';
import type { AppState } from './store';
import { focusDesignHierarchy } from './design-hierarchy-store';
import { carriedSelectionReference } from './selection-reference';
import { pushUndo } from './scene-mutations';
import { moveDesignNode, type DesignHierarchyMove } from '../../core/scene/design-hierarchy-edit';
import { validateSceneBudgets } from '../../io/project/project-scene-integrity-validator';

export type DesignHierarchyOwner = Pick<AppState, 'project' | 'projectDocumentEpoch'>;
export type HierarchyActionResult =
  | { readonly kind: 'ok'; readonly changed: boolean }
  | { readonly kind: 'error'; readonly message: string };

export type DesignHierarchyActions = {
  readonly renameArtwork: (id: string, name: string) => void;
  readonly renameDesignGroup: (id: string, name: string) => void;
  readonly selectDesignArtwork: (id: string) => void;
  readonly selectDesignGroup: (id: string) => void;
  readonly focusDesignGroup: (id: string | null) => void;
  readonly moveDesignNode: (
    move: DesignHierarchyMove,
    owner: DesignHierarchyOwner,
  ) => HierarchyActionResult;
};
type Setter = (update: (state: AppState) => AppState | Partial<AppState>) => void;

export function designHierarchyActions(set: Setter): DesignHierarchyActions {
  return {
    moveDesignNode: (move, owner) => {
      let result: HierarchyActionResult = {
        kind: 'error',
        message: 'The design move was not applied.',
      };
      set((state) => {
        if (
          state.project !== owner.project ||
          state.projectDocumentEpoch !== owner.projectDocumentEpoch
        ) {
          result = {
            kind: 'error',
            message:
              'The project changed after this move began. Choose the artwork and destination again.',
          };
          return state;
        }
        const moved = moveDesignNode(state.project.scene, move);
        if (moved.kind === 'error') {
          result = moved;
          return state;
        }
        const budgetProblem = validateSceneBudgets(moved.scene);
        if (budgetProblem !== null) {
          result = {
            kind: 'error',
            message: `This move exceeds the saved-project scene limits: ${budgetProblem}`,
          };
          return state;
        }
        const changed = moved.scene !== state.project.scene;
        result = { kind: 'ok', changed };
        return changed ? sceneEdit(state, moved.scene, 'Move design item') : state;
      });
      return result;
    },
    renameArtwork: (id, name) => set((state) => renameArtwork(state, id, name)),
    renameDesignGroup: (id, name) => set((state) => renameGroup(state, id, name)),
    selectDesignArtwork: (id) => set((state) => designSelection(state, [id])),
    selectDesignGroup: (id) =>
      set((state) =>
        designSelection(
          state,
          state.project.scene.groups?.find((group) => group.id === id)?.objectIds ?? [],
        ),
      ),
    focusDesignGroup: (id) =>
      set((state) => {
        if (id !== null && !state.project.scene.groups?.some((group) => group.id === id))
          return state;
        focusDesignHierarchy(id, state.projectDocumentEpoch);
        return designSelection(state, []);
      }),
  };
}

function renameArtwork(state: AppState, id: string, value: string): AppState | Partial<AppState> {
  const name = value.trim().normalize('NFC');
  const existing = state.project.scene.objects.find((object) => object.id === id);
  if (existing === undefined || (existing.name ?? '') === name) return state;
  const { name: _old, ...unnamed } = existing;
  const object = name === '' ? unnamed : { ...unnamed, name };
  return sceneEdit(
    state,
    {
      ...state.project.scene,
      objects: state.project.scene.objects.map((candidate) =>
        candidate.id === id ? object : candidate,
      ),
    },
    'Rename artwork',
  );
}

function renameGroup(state: AppState, id: string, value: string): AppState | Partial<AppState> {
  const name = value.trim().normalize('NFC');
  const existing = state.project.scene.groups?.find((group) => group.id === id);
  if (existing === undefined || name === '' || existing.name === name) return state;
  return sceneEdit(
    state,
    {
      ...state.project.scene,
      groups: (state.project.scene.groups ?? []).map((group) =>
        group.id === id ? { ...group, name } : group,
      ),
    },
    'Rename group',
  );
}

function sceneEdit(state: AppState, scene: Scene, name: string): Partial<AppState> {
  return {
    project: { ...state.project, scene },
    undoStack: pushUndo(state.project, state.undoStack, name),
    redoStack: [],
    dirty: true,
  };
}

function designSelection(state: AppState, ids: ReadonlyArray<string>): Partial<AppState> {
  const wanted = new Set(ids);
  const [primary, ...rest] = state.project.scene.objects
    .filter(
      (object) =>
        wanted.has(object.id) &&
        object.locked !== true &&
        sceneObjectHasVisibleLayer(state.project.scene, object),
    )
    .map((object) => object.id);
  const selection = { selectedObjectId: primary ?? null, additionalSelectedIds: new Set(rest) };
  return {
    ...selection,
    selectedPathNode: null,
    selectedPathNodes: [],
    selectionReference: carriedSelectionReference(state, selection),
  };
}
