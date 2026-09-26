import {
  machineKindOf,
  updateLayer,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import {
  applyLayerDefaultSettings,
  captureLayerDefaultSettings,
  type LayerDefaultSettings,
} from '../layers/layer-default-settings';
import { defaultColorForOperation } from './operation-source-color';
import { pushUndo, type StateSlice } from './scene-mutations';

export type LayerDefaultsState = {
  readonly byColor: Readonly<Record<string, LayerDefaultSettings>>;
  readonly allColors: LayerDefaultSettings | null;
};

export const DEFAULT_LAYER_DEFAULTS_STATE: LayerDefaultsState = {
  byColor: {},
  allColors: null,
};

export type LayerDefaultsActions = {
  readonly makeLayerDefault: (layerId: string) => void;
  readonly makeLayerDefaultForAll: (layerId: string) => void;
  readonly resetLayerToDefault: (layerId: string) => void;
  readonly setLayerDefaults: (layerDefaults: LayerDefaultsState) => void;
};

type LayerDefaultActionState = StateSlice & {
  readonly layerDefaults: LayerDefaultsState;
};

type ProjectMutation = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: [];
  readonly dirty: true;
};

type LayerDefaultsMutation = {
  readonly layerDefaults: LayerDefaultsState;
};

type EmptyMutation = Record<string, never>;

type LayerDefaultActionSet = (
  fn:
    | Partial<LayerDefaultActionState>
    | ((state: LayerDefaultActionState) => ProjectMutation | LayerDefaultsMutation | EmptyMutation),
) => void;

export function layerDefaultActions(set: LayerDefaultActionSet): LayerDefaultsActions {
  return {
    makeLayerDefault: (layerId) =>
      set((state) => {
        const { scene } = state.project;
        const layer = scene.layers.find((candidate) => candidate.id === layerId);
        if (layer === undefined) return {};
        return {
          layerDefaults: {
            ...state.layerDefaults,
            byColor: {
              ...state.layerDefaults.byColor,
              [defaultColorForOperation(scene.objects, layer)]: captureLayerDefaultSettings(
                layer,
                machineKindOf(state.project.machine),
              ),
            },
          },
        };
      }),
    makeLayerDefaultForAll: (layerId) =>
      set((state) => {
        const layer = state.project.scene.layers.find((candidate) => candidate.id === layerId);
        if (layer === undefined) return {};
        return {
          layerDefaults: {
            ...state.layerDefaults,
            allColors: captureLayerDefaultSettings(layer, machineKindOf(state.project.machine)),
          },
        };
      }),
    resetLayerToDefault: (layerId) =>
      set((state) => {
        const layer = state.project.scene.layers.find((candidate) => candidate.id === layerId);
        if (layer === undefined) return {};
        const defaults = defaultSettingsForOperation(
          state.layerDefaults,
          state.project.scene.objects,
          layer,
        );
        if (Object.keys(defaults).length === 0) return {};
        const scene = updateLayer(
          state.project.scene,
          layerId,
          applyLayerDefaultSettings(layer, defaults, machineKindOf(state.project.machine)),
        );
        if (scene === state.project.scene) return {};
        return {
          project: { ...state.project, scene },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
    setLayerDefaults: (layerDefaults) => set({ layerDefaults }),
  };
}

// Every path that creates or resets an operation looks its defaults up here,
// under the one key Make Default saves to. There is deliberately no fallback
// to the operation's palette color: a saved key cannot tell an artwork color
// from a palette color, so a default saved for black artwork would reach any
// new operation that happened to get palette black.
export function defaultSettingsForOperation(
  layerDefaults: LayerDefaultsState,
  objects: ReadonlyArray<SceneObject>,
  operation: Layer,
): LayerDefaultSettings {
  return (
    layerDefaults.byColor[defaultColorForOperation(objects, operation)] ??
    layerDefaults.allColors ??
    {}
  );
}
