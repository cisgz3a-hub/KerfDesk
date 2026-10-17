import type { Project } from '../../core/scene';
import { layerWithoutFocusTest } from '../../core/scene/layer';
import { pushUndo } from './scene-mutations';

export type LayerFocusTestActions = {
  /** Turns a Focus Test sample into an ordinary operation, as one undo step. */
  readonly removeLayerFocusTest: (layerId: string) => void;
};

type LayerFocusTestState = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
};

type LayerFocusTestMutation = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};

type LayerFocusTestActionSet = (
  fn: (state: LayerFocusTestState) => LayerFocusTestMutation | Record<string, never>,
) => void;

export function layerFocusTestActions(set: LayerFocusTestActionSet): LayerFocusTestActions {
  return {
    removeLayerFocusTest: (layerId) =>
      set((state) => {
        const scene = state.project.scene;
        const target = scene.layers.find((layer) => layer.id === layerId);
        if (target?.focusTest === undefined) return {};
        const layers = scene.layers.map((layer) =>
          layer.id === layerId ? layerWithoutFocusTest(layer) : layer,
        );
        return {
          project: { ...state.project, scene: { ...scene, layers } },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}
