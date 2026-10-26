import {
  addLayer,
  bindSceneObjectToOperations,
  createLayer,
  operationIdsForObject,
  removeSceneObjectOperationBinding,
  sceneObjectHasVisibleLayer,
  sceneObjectUsesOperation,
  type Layer,
  type Project,
  type Scene,
  updateLayer,
  machineKindOf,
} from '../../core/scene';
import { recolorLayer } from '../../core/scene/scene';
import { applyLayerDefaultSettings } from '../layers/layer-default-settings';
import { seedFreshCncLayer } from './cnc-auto-seeding';
import { seedFreshLaserLayer } from './laser-recipe-seeding';
import type { MaterialLibraryDocument } from '../../io/material-library';
import type { CncLiveCapsState } from './cnc-live-caps-actions';
import { pruneSceneObjectOperationOverrides } from '../../core/scene/operation-binding';
import { defaultSettingsForOperation, type LayerDefaultsState } from './layer-default-actions';
import { layerSubLayerActions, type LayerSubLayerPatch } from './layer-sub-layer-actions';
import {
  layerSettingsEqual,
  layerSettingsForPaste,
  layerSettingsFrom,
  type LayerSettingsClipboard,
} from './layer-settings-clipboard';
import { pushUndo, type StateSlice } from './scene-mutations';
import { refuseSceneLimitOverrun } from './scene-copy-room';

const HEX_LAYER_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export type { LayerSettingsClipboard } from './layer-settings-clipboard';
export type { LayerSubLayerPatch } from './layer-sub-layer-actions';

type LayerActionState = StateSlice &
  CncLiveCapsState & {
    readonly selectedObjectId: string | null;
    readonly additionalSelectedIds: ReadonlySet<string>;
    readonly copiedLayerSettings: LayerSettingsClipboard | null;
    readonly layerDefaults: LayerDefaultsState;
    readonly materialLibrary?: MaterialLibraryDocument | null;
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
  readonly setLayerColor: (layerId: string, color: string) => void;
  readonly switchIslandFillLayersToScanline: () => void;
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
    createManualLayer: createManualLayerAction(set),
    setLayerColor: layerColorSetter(set),
    switchIslandFillLayersToScanline: () =>
      set((state) => {
        let changed = false;
        const layers = state.project.scene.layers.map((layer) => {
          if (layer.mode !== 'fill' || layer.fillStyle !== 'island') return layer;
          changed = true;
          return { ...layer, fillStyle: 'scanline' as const };
        });
        if (!changed) return {};
        return mutation(state, {
          ...state.project,
          scene: { ...state.project.scene, layers },
        });
      }),
    assignSelectionToLayer: (layerId) =>
      set((state) => {
        const target = state.project.scene.layers.find((layer) => layer.id === layerId);
        if (target === undefined) return {};
        const usedBefore = usedOperationIds(state.project.scene);
        const selectedIds = new Set(selectedObjectIds(state));
        let scene: Scene = {
          ...state.project.scene,
          objects: state.project.scene.objects.map((object) =>
            selectedIds.has(object.id) ? bindSceneObjectToOperations(object, [target.id]) : object,
          ),
        };
        scene = pruneAssignmentOrphans(scene, usedBefore);
        if (scene === state.project.scene) return {};
        return mutation(state, { ...state.project, scene });
      }),
    selectObjectsOnLayer: (layerId) =>
      set((state) => {
        const operation = state.project.scene.layers.find((layer) => layer.id === layerId);
        if (operation === undefined) return clearSelection();
        return selectObjectIds(selectableObjectIdsOnLayer(state.project.scene, operation));
      }),
    deleteLayerAndObjects: (layerId) =>
      set((state) => {
        const target = state.project.scene.layers.find((layer) => layer.id === layerId);
        if (target === undefined) return {};
        const result = deleteLayerContent(state.project.scene, target.id);
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
        const settings = layerSettingsForPaste(target, state.copiedLayerSettings);
        if (layerSettingsEqual(target, settings)) return {};
        const scene = updateLayer(state.project.scene, layerId, settings);
        return mutation(state, { ...state.project, scene });
      }),
    ...layerSubLayerActions(set),
  };
}

function createManualLayerAction(set: LayerActionSet): LayerActions['createManualLayer'] {
  return (color) =>
    set((state) => {
      const normalized = normalizeLayerColor(color);
      if (normalized === null) return {};
      if (state.project.scene.layers.some((layer) => layer.color === normalized)) return {};
      const created = createLayer({ id: normalized, color: normalized });
      const defaults = defaultSettingsForOperation(
        state.layerDefaults,
        state.project.scene.objects,
        created,
      );
      const base = applyLayerDefaultSettings(
        created,
        defaults,
        machineKindOf(state.project.machine),
      );
      const machine = state.project.machine;
      const layer =
        machine?.kind === 'cnc'
          ? seedFreshCncLayer(base, {
              device: state.project.device,
              machine,
              liveCaps: state.cncLiveCaps,
            })
          : seedFreshLaserLayer(base, state.project, state.materialLibrary ?? null);
      const scene = addLayer(state.project.scene, layer);
      if (refuseSceneLimitOverrun(state.project.scene, scene, 'Delete unused operations first.'))
        return {};
      return mutation(state, { ...state.project, scene });
    });
}

function layerColorSetter(set: LayerActionSet): LayerActions['setLayerColor'] {
  return (layerId, color) =>
    set((state) => {
      const scene = recolorLayer(state.project.scene, layerId, color);
      return scene === state.project.scene ? {} : mutation(state, { ...state.project, scene });
    });
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
  const usedAfter = usedOperationIds(scene);
  const layers = scene.layers.filter(
    (layer) => usedAfter.has(layer.id) || !usedBefore.has(layer.id),
  );
  return layers.length === scene.layers.length ? scene : { ...scene, layers };
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

function selectableObjectIdsOnLayer(scene: Scene, operation: Layer): ReadonlyArray<string> {
  return scene.objects
    .filter((object) => sceneObjectUsesOperation(object, operation))
    .filter((object) => object.locked !== true)
    .filter((object) => sceneObjectHasVisibleLayer(scene, object))
    .map((object) => object.id);
}

function deleteLayerContent(
  scene: Scene,
  layerId: string,
): { readonly scene: Scene; readonly removedObjectIds: ReadonlySet<string> } | null {
  const removedObjectIds = new Set<string>();
  const objects: Scene['objects'][number][] = [];
  let changed = false;
  for (const object of scene.objects) {
    const operation = scene.layers.find((layer) => layer.id === layerId);
    if (operation === undefined) return null;
    if (!sceneObjectUsesOperation(object, operation)) {
      objects.push(object);
      continue;
    }
    const next = removeSceneObjectOperationBinding(object, layerId, scene.layers);
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
    scene: { ...scene, objects: pruneSceneObjectOperationOverrides(objects, layers), layers },
    removedObjectIds,
  };
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

function usedOperationIds(scene: Scene): ReadonlySet<string> {
  return new Set(scene.objects.flatMap((object) => operationIdsForObject(object, scene.layers)));
}

function mutation(state: StateSlice, project: Project): LayerActionMutation {
  return {
    project,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}
