import {
  createLayerSubLayer,
  nextLayerSubLayerId,
  type LayerOperationSettings,
  type LayerSubLayer,
  type Project,
  updateLayer,
} from '../../core/scene';
import { pushUndo } from './scene-mutations';

export type LayerSubLayerPatch = Partial<LayerOperationSettings> &
  Partial<Pick<LayerSubLayer, 'enabled' | 'label'>>;

export type LayerSubLayerActions = {
  readonly addLayerSubLayer: (layerId: string) => void;
  readonly updateLayerSubLayer: (
    layerId: string,
    subLayerId: string,
    patch: LayerSubLayerPatch,
  ) => void;
  readonly deleteLayerSubLayer: (layerId: string, subLayerId: string) => void;
};

type LayerSubLayerActionState = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
};

type LayerSubLayerActionMutation = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};

type EmptyLayerSubLayerAction = Record<string, never>;

type LayerSubLayerActionSet = (
  fn: (state: LayerSubLayerActionState) => LayerSubLayerActionMutation | EmptyLayerSubLayerAction,
) => void;

export function layerSubLayerActions(set: LayerSubLayerActionSet): LayerSubLayerActions {
  return {
    addLayerSubLayer: (layerId) =>
      set((state) => {
        const layer = state.project.scene.layers.find((candidate) => candidate.id === layerId);
        if (layer === undefined) return {};
        const id = nextLayerSubLayerId(layer);
        const label = `Sub-layer ${id.replace(/^sub-/, '')}`;
        const subLayer = createLayerSubLayer(layer, { id, label });
        return patchLayerSubLayers(state, layerId, [...layer.subLayers, subLayer]);
      }),
    updateLayerSubLayer: (layerId, subLayerId, patch) =>
      set((state) => updateLayerSubLayerState(state, layerId, subLayerId, patch)),
    deleteLayerSubLayer: (layerId, subLayerId) =>
      set((state) => deleteLayerSubLayerState(state, layerId, subLayerId)),
  };
}

function updateLayerSubLayerState(
  state: LayerSubLayerActionState,
  layerId: string,
  subLayerId: string,
  patch: LayerSubLayerPatch,
): LayerSubLayerActionMutation | EmptyLayerSubLayerAction {
  const layer = state.project.scene.layers.find((candidate) => candidate.id === layerId);
  if (layer === undefined) return {};
  let changed = false;
  const subLayers = layer.subLayers.map((subLayer) => {
    if (subLayer.id !== subLayerId) return subLayer;
    changed = true;
    return applySubLayerPatch(subLayer, patch);
  });
  return changed ? patchLayerSubLayers(state, layerId, subLayers) : {};
}

function deleteLayerSubLayerState(
  state: LayerSubLayerActionState,
  layerId: string,
  subLayerId: string,
): LayerSubLayerActionMutation | EmptyLayerSubLayerAction {
  const layer = state.project.scene.layers.find((candidate) => candidate.id === layerId);
  if (layer === undefined) return {};
  const subLayers = layer.subLayers.filter((subLayer) => subLayer.id !== subLayerId);
  return subLayers.length === layer.subLayers.length
    ? {}
    : patchLayerSubLayers(state, layerId, subLayers);
}

function patchLayerSubLayers(
  state: LayerSubLayerActionState,
  layerId: string,
  subLayers: ReadonlyArray<LayerSubLayer>,
): LayerSubLayerActionMutation {
  const scene = updateLayer(state.project.scene, layerId, { subLayers });
  return {
    project: { ...state.project, scene },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function applySubLayerPatch(subLayer: LayerSubLayer, patch: LayerSubLayerPatch): LayerSubLayer {
  const { enabled, label, ...settingsPatch } = patch;
  return {
    ...subLayer,
    ...(enabled !== undefined ? { enabled } : {}),
    ...(label !== undefined ? { label } : {}),
    settings: { ...subLayer.settings, ...settingsPatch },
  };
}
