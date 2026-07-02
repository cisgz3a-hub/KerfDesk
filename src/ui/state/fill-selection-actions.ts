import {
  addLayer,
  assignObjectToLayer,
  assertNever,
  createLayer,
  updateLayer,
  type Project,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { applyLayerDefaultSettings } from '../layers/layer-default-settings';
import { defaultSettingsForColor, type LayerDefaultsState } from './layer-default-actions';
import { pruneOrphanLayers, pushUndo, type StateSlice } from './scene-mutations';

export type FillSelectionActions = {
  readonly fillSelectionSeparately: () => void;
};

type FillSelectionState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly layerDefaults: LayerDefaultsState;
};

type FillSelectionMutation = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};

type EmptyFillSelectionMutation = Record<string, never>;

type FillSelectionSet = (
  fn: (state: FillSelectionState) => FillSelectionMutation | EmptyFillSelectionMutation,
) => void;

export function fillSelectionActions(set: FillSelectionSet): FillSelectionActions {
  return {
    fillSelectionSeparately: () => set((state) => fillSelectionMutation(state)),
  };
}

function fillSelectionMutation(
  state: FillSelectionState,
): FillSelectionMutation | EmptyFillSelectionMutation {
  const selectedIds = selectedVectorObjectIds(state);
  if (selectedIds.size === 0) return {};
  const selectedColors = colorsUsedBySelectedVectors(state.project.scene, selectedIds);
  const targetColor = unsharedSelectedColor(state.project.scene, selectedIds, selectedColors);
  const scene =
    targetColor === null
      ? isolateSelectionToNewFillLayer(state, selectedIds)
      : ensureFillLayer(state.project.scene, targetColor, state.layerDefaults);
  if (scene === state.project.scene) return {};
  return {
    project: { ...state.project, scene },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function isolateSelectionToNewFillLayer(
  state: FillSelectionState,
  selectedIds: ReadonlySet<string>,
): Scene {
  const color = nextFillLayerColor(state.project.scene);
  let scene = ensureFillLayer(state.project.scene, color, state.layerDefaults);
  for (const id of selectedIds) scene = assignObjectToLayer(scene, id, color);
  return pruneOrphanLayers(scene);
}

function ensureFillLayer(scene: Scene, color: string, layerDefaults: LayerDefaultsState): Scene {
  const existing = scene.layers.find((layer) => layer.color === color);
  if (existing !== undefined) {
    return existing.mode === 'fill' ? scene : updateLayer(scene, existing.id, { mode: 'fill' });
  }
  const defaults = defaultSettingsForColor(layerDefaults, color);
  const layer = applyLayerDefaultSettings(createLayer({ id: color, color }), defaults);
  return addLayer(scene, { ...layer, mode: 'fill' });
}

function selectedVectorObjectIds(state: FillSelectionState): ReadonlySet<string> {
  const ids = new Set([
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ]);
  return new Set(
    state.project.scene.objects
      .filter((object) => ids.has(object.id) && isVectorObject(object))
      .map((object) => object.id),
  );
}

function colorsUsedBySelectedVectors(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const colors = new Set<string>();
  for (const object of scene.objects) {
    if (!selectedIds.has(object.id) || !isVectorObject(object)) continue;
    for (const path of object.paths) colors.add(path.color);
  }
  return colors;
}

function unsharedSelectedColor(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
  selectedColors: ReadonlySet<string>,
): string | null {
  if (selectedColors.size !== 1) return null;
  const [color] = [...selectedColors];
  if (color === undefined) return null;
  return unselectedObjectUsesColor(scene, selectedIds, color) ? null : color;
}

function unselectedObjectUsesColor(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
  color: string,
): boolean {
  return scene.objects.some(
    (object) => !selectedIds.has(object.id) && objectUsesLayerColor(object, color),
  );
}

function objectUsesLayerColor(object: SceneObject, color: string): boolean {
  switch (object.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return object.paths.some((path) => path.color === color);
    case 'raster-image':
    case 'relief':
      return object.color === color;
    default:
      return assertNever(object, 'SceneObject');
  }
}

function isVectorObject(
  object: SceneObject,
): object is Extract<SceneObject, { readonly paths: ReadonlyArray<unknown> }> {
  switch (object.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return true;
    case 'raster-image':
    case 'relief':
      return false;
    default:
      return assertNever(object, 'SceneObject');
  }
}

function nextFillLayerColor(scene: Scene): string {
  const used = usedColors(scene);
  for (const color of PREFERRED_FILL_LAYER_COLORS) {
    if (!used.has(color)) return color;
  }
  for (let n = LOWEST_GENERATED_COLOR; n <= MAX_RGB_COLOR; n += 1) {
    const color = `#${n.toString(16).padStart(HEX_COLOR_DIGITS, '0')}`;
    if (!used.has(color)) return color;
  }
  return PREFERRED_FILL_LAYER_COLORS[0];
}

function usedColors(scene: Scene): ReadonlySet<string> {
  const colors = new Set(scene.layers.map((layer) => layer.color));
  for (const object of scene.objects) {
    switch (object.kind) {
      case 'imported-svg':
      case 'text':
      case 'traced-image':
      case 'shape':
        for (const path of object.paths) colors.add(path.color);
        break;
      case 'raster-image':
      case 'relief':
        colors.add(object.color);
        break;
      default:
        assertNever(object, 'SceneObject');
    }
  }
  return colors;
}

/* eslint-disable no-restricted-syntax -- scene DATA colors: generated layer color keys, not UI chrome (ADR-047). */
const PREFERRED_FILL_LAYER_COLORS = [
  '#0066ff',
  '#ff8800',
  '#00aa55',
  '#cc33ff',
  '#ff3366',
  '#555555',
] as const;
/* eslint-enable no-restricted-syntax */
const LOWEST_GENERATED_COLOR = 1;
const MAX_RGB_COLOR = 0xffffff;
const HEX_COLOR_DIGITS = 6;
