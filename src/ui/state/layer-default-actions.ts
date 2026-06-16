import { updateLayer, type Project } from '../../core/scene';
import {
  captureLayerDefaultSettings,
  type LayerDefaultSettings,
} from '../layers/layer-default-settings';
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
        const layer = state.project.scene.layers.find((candidate) => candidate.id === layerId);
        if (layer === undefined) return {};
        return {
          layerDefaults: {
            ...state.layerDefaults,
            byColor: {
              ...state.layerDefaults.byColor,
              [layer.color]: captureLayerDefaultSettings(layer),
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
            allColors: captureLayerDefaultSettings(layer),
          },
        };
      }),
    resetLayerToDefault: (layerId) =>
      set((state) => {
        const layer = state.project.scene.layers.find((candidate) => candidate.id === layerId);
        if (layer === undefined) return {};
        const defaults = defaultSettingsForColor(state.layerDefaults, layer.color);
        if (Object.keys(defaults).length === 0) return {};
        const scene = updateLayer(state.project.scene, layerId, defaults);
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

export function defaultSettingsForColor(
  layerDefaults: LayerDefaultsState,
  color: string,
): LayerDefaultSettings {
  return layerDefaults.byColor[color] ?? layerDefaults.allColors ?? {};
}
