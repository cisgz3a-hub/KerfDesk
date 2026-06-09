import type { Scene } from '../../core/scene';
import { pushUndo, type StateSlice } from './scene-mutations';

type GeneratedSceneState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly redoStack: ReadonlyArray<GeneratedSceneState['project']>;
  readonly dirty: boolean;
};

type GeneratedScenePatch = {
  readonly project: GeneratedSceneState['project'];
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly undoStack: ReadonlyArray<GeneratedSceneState['project']>;
  readonly redoStack: ReadonlyArray<GeneratedSceneState['project']>;
  readonly dirty: boolean;
};

type GeneratedSceneSet = (fn: (state: GeneratedSceneState) => GeneratedScenePatch) => void;

export type GeneratedSceneActions = {
  readonly replaceSceneWithGeneratedScene: (scene: Scene) => void;
};

export function generatedSceneActions(set: GeneratedSceneSet): GeneratedSceneActions {
  return {
    replaceSceneWithGeneratedScene: (scene) =>
      set((state) => ({
        project: { ...state.project, scene },
        selectedObjectId: null,
        additionalSelectedIds: new Set(),
        undoStack: pushUndo(state.project, state.undoStack),
        redoStack: [],
        dirty: true,
      })),
  };
}
