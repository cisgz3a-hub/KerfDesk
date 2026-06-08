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

type LayerSelectionMutation = {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

type EmptyLayerAction = Record<string, never>;

type LayerActionSet = (
  fn: (state: LayerActionState) => LayerActionMutation | LayerSelectionMutation | EmptyLayerAction,
) => void;

export type LayerActions = {
  readonly createManualLayer: (color: string) => void;
  readonly assignSelectionToLayer: (layerId: string) => void;
  readonly selectObjectsOnLayer: (layerId: string) => void;
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
    selectObjectsOnLayer: (layerId) =>
      set((state) => {
        const color = layerColorForSelection(state.project.scene, layerId);
        if (color === null) return clearSelection();
        return selectObjectIds(
          state.project.scene.objects
            .filter((object) => objectUsesLayerColor(object, color))
            .map((object) => object.id),
        );
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

function layerColorForSelection(scene: Scene, layerId: string): string | null {
  const layer = scene.layers.find((candidate) => candidate.id === layerId);
  if (layer !== undefined) return layer.color;
  return normalizeLayerColor(layerId);
}

function selectObjectIds(ids: ReadonlyArray<string>): LayerSelectionMutation {
  const [primary, ...rest] = ids;
  return {
    selectedObjectId: primary ?? null,
    additionalSelectedIds: new Set(rest),
  };
}

function clearSelection(): LayerSelectionMutation {
  return { selectedObjectId: null, additionalSelectedIds: new Set() };
}

function objectUsesLayerColor(object: Scene['objects'][number], color: string): boolean {
  switch (object.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
      return object.paths.some((path) => path.color === color);
    case 'raster-image':
      return object.color === color;
    default:
      return assertNever(object, 'SceneObject');
  }
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
