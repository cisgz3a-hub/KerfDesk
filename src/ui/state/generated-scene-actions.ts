import type { Scene } from '../../core/scene';
import type { JobPlacementSettings } from '../job-placement';
import { projectWithCurrentJobSetup } from './project-job-setup';
import { pushUndo, type StateSlice } from './scene-mutations';
import { captureSetupHistoryContext, type SetupHistoryContext } from './setup-history-context';

type GeneratedSceneState = StateSlice &
  SetupHistoryContext & {
    readonly redoStack: ReadonlyArray<GeneratedSceneState['project']>;
    readonly dirty: boolean;
  };

type GeneratedScenePatch = {
  readonly project: GeneratedSceneState['project'];
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly jobPlacement?: JobPlacementSettings;
  readonly undoStack: ReadonlyArray<GeneratedSceneState['project']>;
  readonly redoStack: ReadonlyArray<GeneratedSceneState['project']>;
  readonly dirty: boolean;
};

type GeneratedSceneSet = (fn: (state: GeneratedSceneState) => GeneratedScenePatch) => void;

export type GeneratedSceneActions = {
  /**
   * `placement` changes Start From in the same Undo step as the scene. The
   * project's Print and Cut marks go too: they name marks of the design
   * being replaced, and a Start would otherwise move the generated pattern by
   * their registration (camera audit v2 K3-P1-4, ADR-443 Amendment 4).
   */
  readonly replaceSceneWithGeneratedScene: (
    scene: Scene,
    selectGenerated?: boolean,
    placement?: Partial<JobPlacementSettings>,
  ) => void;
};

export function generatedSceneActions(set: GeneratedSceneSet): GeneratedSceneActions {
  return {
    replaceSceneWithGeneratedScene: (scene, selectGenerated = false, placement) =>
      set((state) => {
        const { printAndCutTargets: _marks, ...rest } = state.project;
        const project = { ...rest, scene };
        const patch = {
          project,
          selectedObjectId: selectGenerated ? (scene.objects[0]?.id ?? null) : null,
          additionalSelectedIds: new Set(
            selectGenerated ? scene.objects.slice(1).map((object) => object.id) : [],
          ),
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
        if (placement === undefined) return patch;
        // Undo and Redo restore the placement with the scene (ADR-654 Amendment 2).
        captureSetupHistoryContext(state.project, state);
        const jobPlacement = { ...state.jobPlacement, ...placement };
        return {
          ...patch,
          jobPlacement,
          project: projectWithCurrentJobSetup({ ...state, ...patch, jobPlacement }),
        };
      }),
  };
}
