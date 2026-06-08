import {
  addLayer,
  assignObjectToLayer,
  assertNever,
  createLayer,
  type Project,
  type Scene,
} from '../../core/scene';
import { pushUndo, type StateSlice } from './scene-mutations';

const HEX_LAYER_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

type LayerActionState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

type LayerActionMutation = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};

type EmptyLayerAction = Record<string, never>;

type LayerActionSet = (
  fn: (state: LayerActionState) => LayerActionMutation | EmptyLayerAction,
) => void;

export type LayerActions = {
  readonly createManualLayer: (color: string) => void;
  readonly assignSelectionToLayer: (layerId: string) => void;
};

export function layerActions(set: LayerActionSet): LayerActions {
  return {
    createManualLayer: (color) =>
      set((state) => {
        const normalized = normalizeLayerColor(color);
        if (normalized === null) return {};
        if (state.project.scene.layers.some((layer) => layer.color === normalized)) return {};
        const scene = addLayer(
          state.project.scene,
          createLayer({ id: normalized, color: normalized }),
        );
        return mutation(state, { ...state.project, scene });
      }),
    assignSelectionToLayer: (layerId) =>
      set((state) => {
        const target = state.project.scene.layers.find((layer) => layer.id === layerId);
        if (target === undefined) return {};
        const usedBefore = usedLayerColors(state.project.scene);
        let scene = state.project.scene;
        for (const id of selectedObjectIds(state)) {
          scene = assignObjectToLayer(scene, id, target.color);
        }
        scene = pruneAssignmentOrphans(scene, usedBefore);
        if (scene === state.project.scene) return {};
        return mutation(state, { ...state.project, scene });
      }),
  };
}

function selectedObjectIds(state: LayerActionState): ReadonlyArray<string> {
  return [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ];
}

function normalizeLayerColor(color: string): string | null {
  return HEX_LAYER_COLOR_RE.test(color) ? color.toLowerCase() : null;
}

function pruneAssignmentOrphans(scene: Scene, usedBefore: ReadonlySet<string>): Scene {
  const usedAfter = usedLayerColors(scene);
  const layers = scene.layers.filter(
    (layer) => usedAfter.has(layer.color) || !usedBefore.has(layer.color),
  );
  return layers.length === scene.layers.length ? scene : { ...scene, layers };
}

function usedLayerColors(scene: Scene): ReadonlySet<string> {
  const colors = new Set<string>();
  for (const object of scene.objects) {
    switch (object.kind) {
      case 'imported-svg':
      case 'text':
      case 'traced-image':
        for (const path of object.paths) colors.add(path.color);
        break;
      case 'raster-image':
        colors.add(object.color);
        break;
      default:
        assertNever(object, 'SceneObject');
    }
  }
  return colors;
}

function mutation(state: StateSlice, project: Project): LayerActionMutation {
  return {
    project,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}
