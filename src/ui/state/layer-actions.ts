import {
  addLayer,
  assignObjectToLayer,
  assertNever,
  createLayer,
  layerOperationSettingsEqual,
  type Layer,
  type LayerSubLayer,
  type Project,
  type Scene,
  updateLayer,
} from '../../core/scene';
import { applyLayerDefaultSettings } from '../layers/layer-default-settings';
import { defaultSettingsForColor, type LayerDefaultsState } from './layer-default-actions';
import { layerSubLayerActions, type LayerSubLayerPatch } from './layer-sub-layer-actions';
import { pushUndo, type StateSlice } from './scene-mutations';

const HEX_LAYER_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export type LayerSettingsClipboard = Omit<Layer, 'id' | 'color'>;
export type { LayerSubLayerPatch } from './layer-sub-layer-actions';

type LayerActionState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly copiedLayerSettings: LayerSettingsClipboard | null;
  readonly layerDefaults: LayerDefaultsState;
};

type LayerActionMutation = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
  readonly selectedObjectId?: string | null;
  readonly additionalSelectedIds?: ReadonlySet<string>;
};

type LayerSelectionMutation = {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

type LayerClipboardMutation = {
  readonly copiedLayerSettings: LayerSettingsClipboard | null;
};

type EmptyLayerAction = Record<string, never>;

type LayerActionSet = (
  fn: (
    state: LayerActionState,
  ) => LayerActionMutation | LayerSelectionMutation | LayerClipboardMutation | EmptyLayerAction,
) => void;

export type LayerActions = {
  readonly createManualLayer: (color: string) => void;
  readonly assignSelectionToLayer: (layerId: string) => void;
  readonly selectObjectsOnLayer: (layerId: string) => void;
  readonly deleteLayerAndObjects: (layerId: string) => void;
  readonly copyLayerSettings: (layerId: string) => void;
  readonly pasteLayerSettings: (layerId: string) => void;
  readonly addLayerSubLayer: (layerId: string) => void;
  readonly updateLayerSubLayer: (
    layerId: string,
    subLayerId: string,
    patch: LayerSubLayerPatch,
  ) => void;
  readonly deleteLayerSubLayer: (layerId: string, subLayerId: string) => void;
};

export function layerActions(set: LayerActionSet): LayerActions {
  return {
    createManualLayer: (color) =>
      set((state) => {
        const normalized = normalizeLayerColor(color);
        if (normalized === null) return {};
        if (state.project.scene.layers.some((layer) => layer.color === normalized)) return {};
        const defaults = defaultSettingsForColor(state.layerDefaults, normalized);
        const scene = addLayer(
          state.project.scene,
          applyLayerDefaultSettings(createLayer({ id: normalized, color: normalized }), defaults),
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
    deleteLayerAndObjects: (layerId) =>
      set((state) => {
        const target = state.project.scene.layers.find((layer) => layer.id === layerId);
        if (target === undefined) return {};
        const result = deleteLayerContent(state.project.scene, target.id, target.color);
        if (result === null) return {};
        return {
          ...mutation(state, { ...state.project, scene: result.scene }),
          ...removeDeletedIdsFromSelection(state, result.removedObjectIds),
        };
      }),
    copyLayerSettings: (layerId) =>
      set((state) => {
        const layer = state.project.scene.layers.find((candidate) => candidate.id === layerId);
        return layer === undefined ? {} : { copiedLayerSettings: layerSettingsFrom(layer) };
      }),
    pasteLayerSettings: (layerId) =>
      set((state) => {
        if (state.copiedLayerSettings === null) return {};
        const target = state.project.scene.layers.find((layer) => layer.id === layerId);
        if (target === undefined) return {};
        if (layerSettingsEqual(target, state.copiedLayerSettings)) return {};
        const scene = updateLayer(state.project.scene, layerId, state.copiedLayerSettings);
        return mutation(state, { ...state.project, scene });
      }),
    ...layerSubLayerActions(set),
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
    case 'shape':
      return object.paths.some((path) => path.color === color);
    case 'raster-image':
      return object.color === color;
    default:
      return assertNever(object, 'SceneObject');
  }
}

function deleteLayerContent(
  scene: Scene,
  layerId: string,
  color: string,
): { readonly scene: Scene; readonly removedObjectIds: ReadonlySet<string> } | null {
  const usedBefore = usedLayerColors(scene);
  const removedObjectIds = new Set<string>();
  const objects: Scene['objects'][number][] = [];
  let changed = false;
  for (const object of scene.objects) {
    const next = removeLayerColorFromObject(object, color);
    if (next === null) {
      removedObjectIds.add(object.id);
      changed = true;
      continue;
    }
    if (next !== object) changed = true;
    objects.push(next);
  }
  const layers = scene.layers.filter((layer) => layer.id !== layerId);
  if (layers.length !== scene.layers.length) changed = true;
  if (!changed) return null;
  return {
    scene: pruneAssignmentOrphans({ ...scene, objects, layers }, usedBefore),
    removedObjectIds,
  };
}

function removeLayerColorFromObject(
  object: Scene['objects'][number],
  color: string,
): Scene['objects'][number] | null {
  switch (object.kind) {
    case 'imported-svg':
    case 'traced-image': {
      const paths = object.paths.filter((path) => path.color !== color);
      if (paths.length === object.paths.length) return object;
      return paths.length === 0 ? null : { ...object, paths };
    }
    case 'text':
    case 'shape':
      return object.color === color || object.paths.some((path) => path.color === color)
        ? null
        : object;
    case 'raster-image':
      return object.color === color ? null : object;
    default:
      return assertNever(object, 'SceneObject');
  }
}

function removeDeletedIdsFromSelection(
  state: LayerActionState,
  removedObjectIds: ReadonlySet<string>,
): LayerSelectionMutation {
  const additionalSelectedIds = new Set(
    [...state.additionalSelectedIds].filter((id) => !removedObjectIds.has(id)),
  );
  return {
    selectedObjectId:
      state.selectedObjectId !== null && removedObjectIds.has(state.selectedObjectId)
        ? null
        : state.selectedObjectId,
    additionalSelectedIds,
  };
}

const LAYER_SETTING_KEYS = [
  'mode',
  'minPower',
  'power',
  'speed',
  'passes',
  'airAssist',
  'kerfOffsetMm',
  'tabsEnabled',
  'tabSizeMm',
  'tabsPerShape',
  'tabSkipInnerShapes',
  'visible',
  'output',
  'hatchAngleDeg',
  'hatchSpacingMm',
  'fillOverscanMm',
  'fillStyle',
  'fillBidirectional',
  'fillCrossHatch',
  'ditherAlgorithm',
  'linesPerMm',
  'imageBidirectional',
  'negativeImage',
  'passThrough',
  'dotWidthCorrectionMm',
  'subLayers',
] as const satisfies ReadonlyArray<keyof LayerSettingsClipboard>;

function layerSettingsFrom(layer: Layer): LayerSettingsClipboard {
  return {
    mode: layer.mode,
    minPower: layer.minPower,
    power: layer.power,
    speed: layer.speed,
    passes: layer.passes,
    airAssist: layer.airAssist,
    kerfOffsetMm: layer.kerfOffsetMm,
    tabsEnabled: layer.tabsEnabled,
    tabSizeMm: layer.tabSizeMm,
    tabsPerShape: layer.tabsPerShape,
    tabSkipInnerShapes: layer.tabSkipInnerShapes,
    visible: layer.visible,
    output: layer.output,
    hatchAngleDeg: layer.hatchAngleDeg,
    hatchSpacingMm: layer.hatchSpacingMm,
    fillOverscanMm: layer.fillOverscanMm,
    fillStyle: layer.fillStyle,
    fillBidirectional: layer.fillBidirectional,
    fillCrossHatch: layer.fillCrossHatch,
    ditherAlgorithm: layer.ditherAlgorithm,
    linesPerMm: layer.linesPerMm,
    imageBidirectional: layer.imageBidirectional,
    negativeImage: layer.negativeImage,
    passThrough: layer.passThrough,
    dotWidthCorrectionMm: layer.dotWidthCorrectionMm,
    subLayers: layer.subLayers,
  };
}

function layerSettingsEqual(layer: Layer, settings: LayerSettingsClipboard): boolean {
  return LAYER_SETTING_KEYS.every((key) =>
    key === 'subLayers'
      ? subLayersEqual(layer.subLayers, settings.subLayers)
      : layer[key] === settings[key],
  );
}

function subLayersEqual(
  left: ReadonlyArray<LayerSubLayer>,
  right: ReadonlyArray<LayerSubLayer>,
): boolean {
  return (
    left.length === right.length &&
    left.every((subLayer, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        subLayer.id === other.id &&
        subLayer.label === other.label &&
        subLayer.enabled === other.enabled &&
        layerOperationSettingsEqual(subLayer.settings, other.settings)
      );
    })
  );
}

function usedLayerColors(scene: Scene): ReadonlySet<string> {
  const colors = new Set<string>();
  for (const object of scene.objects) {
    switch (object.kind) {
      case 'imported-svg':
      case 'text':
      case 'traced-image':
      case 'shape':
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
