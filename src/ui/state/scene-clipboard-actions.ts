import {
  addLayer,
  addObject,
  createArtworkOperation,
  operationIdsForObject,
  remapSceneObjectOperationBindings,
  sceneObjectUsesOperation,
  type Layer,
  type Scene,
  type SceneGroup,
  type SceneObject,
} from '../../core/scene';
import { cloneLayerSubLayers } from '../../core/scene/layer';
import { pruneOrphanLayers, pushUndo } from './scene-mutations';
import { removeObjectIdsFromGroups } from './scene-group-actions';
import type { AppState } from './store';

const PASTE_OFFSET_MM = 10;

export type SceneClipboard = {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly layers: ReadonlyArray<Layer>;
  readonly groups?: ReadonlyArray<SceneGroup>;
};

export type SceneClipboardActions = {
  readonly copySelection: () => void;
  readonly cutSelection: () => void;
  readonly pasteClipboard: () => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function sceneClipboardActions(set: Setter): SceneClipboardActions {
  return {
    copySelection: () =>
      set((state) => {
        const clipboard = clipboardFromSelection(state);
        return clipboard === null ? state : { sceneClipboard: clipboard };
      }),
    cutSelection: () =>
      set((state) => {
        const clipboard = clipboardFromSelection(state);
        if (clipboard === null) return state;
        const cutIds = new Set(clipboard.objects.map((object) => object.id));
        const objects = state.project.scene.objects.filter((object) => !cutIds.has(object.id));
        const scene = pruneOrphanLayers(
          removeObjectIdsFromGroups({ ...state.project.scene, objects }, cutIds),
        );
        return {
          sceneClipboard: clipboard,
          project: { ...state.project, scene },
          selectedObjectId: null,
          additionalSelectedIds: new Set<string>(),
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
    pasteClipboard: () =>
      set((state) => {
        const clipboard = state.sceneClipboard;
        if (clipboard === null || clipboard.objects.length === 0) return state;
        const prepared = prepareClipboardPaste(
          state.project.scene,
          clipboard.layers,
          clipboard.objects,
          clipboard.groups ?? [],
        );
        const pasted = prepared.objects;
        let scene = prepared.scene;
        for (const object of pasted) scene = addObject(scene, object);
        if (prepared.groups.length > 0) {
          scene = { ...scene, groups: [...(scene.groups ?? []), ...prepared.groups] };
        }
        const [primary, ...rest] = pasted.map((object) => object.id);
        return {
          project: { ...state.project, scene },
          selectedObjectId: primary ?? null,
          additionalSelectedIds: new Set(rest),
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}

function clipboardFromSelection(
  state: Pick<AppState, 'project' | 'selectedObjectId' | 'additionalSelectedIds'>,
): SceneClipboard | null {
  const ids = [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ];
  if (ids.length === 0) return null;
  const selected = ids
    .map((id) => state.project.scene.objects.find((object) => object.id === id))
    .filter((object): object is SceneObject => object !== undefined);
  const closureIds = new Set(selected.map((object) => object.id));
  for (const object of selected) {
    if (object.kind === 'raster-image' && object.imageMaskId !== undefined) {
      closureIds.add(object.imageMaskId);
    }
  }
  const objects = state.project.scene.objects
    .filter((object) => closureIds.has(object.id))
    .map(cloneSceneObject);
  if (objects.length === 0) return null;
  const copiedIds = new Set(objects.map((object) => object.id));
  const groups = (state.project.scene.groups ?? [])
    .map((group) => ({
      ...group,
      objectIds: group.objectIds.filter((id) => copiedIds.has(id)),
    }))
    .filter((group) => group.objectIds.length >= 2)
    .map((group) => structuredClone(group) as SceneGroup);
  return { objects, layers: copiedLayersForObjects(state.project.scene, objects), groups };
}

function copiedLayersForObjects(
  scene: Scene,
  objects: ReadonlyArray<SceneObject>,
): ReadonlyArray<Layer> {
  const operationIds = new Set(
    objects.flatMap((object) => operationIdsForObject(object, scene.layers)),
  );
  return scene.layers.filter((layer) => operationIds.has(layer.id)).map(cloneLayer);
}

function cloneClipboardObjects(
  objects: ReadonlyArray<SceneObject>,
  sourceOperations: ReadonlyArray<Layer>,
  operationIdMap: ReadonlyMap<string, string>,
): {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly idMap: ReadonlyMap<string, string>;
} {
  const idMap = new Map(objects.map((object) => [object.id, crypto.randomUUID()] as const));
  return {
    idMap,
    objects: objects.map((object) => {
      const clone = {
        ...cloneSceneObject(object),
        id: idMap.get(object.id) ?? crypto.randomUUID(),
        transform: {
          ...object.transform,
          x: object.transform.x + PASTE_OFFSET_MM,
          y: object.transform.y + PASTE_OFFSET_MM,
        },
      } as SceneObject;
      return remapSceneObjectOperationBindings(
        remapClipboardReferences(clone, idMap),
        sourceOperations,
        operationIdMap,
      );
    }),
  };
}

function remapClipboardReferences(
  object: SceneObject,
  idMap: ReadonlyMap<string, string>,
): SceneObject {
  if (object.kind !== 'raster-image' || object.imageMaskId === undefined) return object;
  const mapped = idMap.get(object.imageMaskId);
  return mapped === undefined ? object : { ...object, imageMaskId: mapped };
}

function prepareClipboardPaste(
  scene: Scene,
  copiedLayers: ReadonlyArray<Layer>,
  objects: ReadonlyArray<SceneObject>,
  groups: ReadonlyArray<SceneGroup> = [],
): {
  readonly scene: Scene;
  readonly objects: ReadonlyArray<SceneObject>;
  readonly groups: ReadonlyArray<SceneGroup>;
} {
  let out = scene;
  const operationIdMap = new Map<string, string>();
  for (const source of copiedLayers) {
    const representative = objects.find((object) => sceneObjectUsesOperation(object, source));
    if (representative === undefined) continue;
    const seed = createArtworkOperation(out, representative, {
      mode: source.mode,
      name: source.name,
    }).operation;
    const operation: Layer = {
      ...cloneLayer(source),
      id: seed.id,
      name: seed.name,
      color: seed.color,
      subLayers: cloneLayerSubLayers(source.subLayers),
    };
    operationIdMap.set(source.id, operation.id);
    out = addLayer(out, operation);
  }
  const cloned = cloneClipboardObjects(objects, copiedLayers, operationIdMap);
  return {
    scene: out,
    objects: cloned.objects,
    groups: groups.map((group) => ({
      ...structuredClone(group),
      id: crypto.randomUUID(),
      objectIds: group.objectIds.flatMap((id) => {
        const mapped = cloned.idMap.get(id);
        return mapped === undefined ? [] : [mapped];
      }),
    })),
  };
}

function cloneSceneObject(object: SceneObject): SceneObject {
  return structuredClone(object) as SceneObject;
}

function cloneLayer(layer: Layer): Layer {
  return structuredClone(layer) as Layer;
}
