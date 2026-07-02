import {
  addLayer,
  addObject,
  createLayer,
  machineKindOf,
  type Layer,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { pruneOrphanLayers, pushUndo } from './scene-mutations';
import { removeObjectIdsFromGroups } from './scene-group-actions';
import { useToastStore } from './toast-store';
import type { AppState } from './store';

const PASTE_OFFSET_MM = 10;

export type SceneClipboard = {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly layers: ReadonlyArray<Layer>;
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
        // Reliefs are CNC-only geometry: paste must honor the same machine
        // gate as STL import, or the clipboard becomes a laser-mode back
        // door (ADR-100 §8 follow-up).
        const pasteable = pasteableClipboardObjects(clipboard.objects, state);
        if (pasteable.length === 0) return state;
        const pasted = cloneClipboardObjects(pasteable);
        let scene = ensureClipboardLayers(state.project.scene, clipboard.layers, pasted);
        for (const object of pasted) scene = addObject(scene, object);
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

function pasteableClipboardObjects(
  objects: ReadonlyArray<SceneObject>,
  state: Pick<AppState, 'project'>,
): ReadonlyArray<SceneObject> {
  if (machineKindOf(state.project.machine) === 'cnc') return objects;
  const kept = objects.filter((object) => object.kind !== 'relief');
  if (kept.length !== objects.length) {
    const skipped = objects.length - kept.length;
    useToastStore
      .getState()
      .pushToast(
        `Skipped ${skipped} relief object${skipped === 1 ? '' : 's'} — reliefs only paste in CNC mode.`,
        'warning',
      );
  }
  return kept;
}

function clipboardFromSelection(
  state: Pick<AppState, 'project' | 'selectedObjectId' | 'additionalSelectedIds'>,
): SceneClipboard | null {
  const ids = [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ];
  if (ids.length === 0) return null;
  const objects = ids
    .map((id) => state.project.scene.objects.find((object) => object.id === id))
    .filter((object): object is SceneObject => object !== undefined)
    .map(cloneSceneObject);
  if (objects.length === 0) return null;
  return { objects, layers: copiedLayersForObjects(state.project.scene, objects) };
}

function copiedLayersForObjects(
  scene: Scene,
  objects: ReadonlyArray<SceneObject>,
): ReadonlyArray<Layer> {
  const colors = new Set(
    objects.flatMap((object) => layerSpecsForObject(object).map((s) => s.color)),
  );
  return scene.layers.filter((layer) => colors.has(layer.color)).map(cloneLayer);
}

function cloneClipboardObjects(objects: ReadonlyArray<SceneObject>): ReadonlyArray<SceneObject> {
  const idMap = new Map(objects.map((object) => [object.id, crypto.randomUUID()] as const));
  return objects.map((object) => {
    const clone = {
      ...cloneSceneObject(object),
      id: idMap.get(object.id) ?? crypto.randomUUID(),
      transform: {
        ...object.transform,
        x: object.transform.x + PASTE_OFFSET_MM,
        y: object.transform.y + PASTE_OFFSET_MM,
      },
    } as SceneObject;
    return remapClipboardReferences(clone, idMap);
  });
}

function remapClipboardReferences(
  object: SceneObject,
  idMap: ReadonlyMap<string, string>,
): SceneObject {
  if (object.kind !== 'raster-image' || object.imageMaskId === undefined) return object;
  const mapped = idMap.get(object.imageMaskId);
  return mapped === undefined ? object : { ...object, imageMaskId: mapped };
}

function ensureClipboardLayers(
  scene: Scene,
  copiedLayers: ReadonlyArray<Layer>,
  objects: ReadonlyArray<SceneObject>,
): Scene {
  let out = scene;
  for (const layer of copiedLayers) {
    if (!out.layers.some((candidate) => candidate.color === layer.color)) {
      out = addLayer(out, cloneLayer(layer));
    }
  }
  for (const object of objects) {
    for (const spec of layerSpecsForObject(object)) out = ensureLayer(out, spec);
  }
  return out;
}

function ensureLayer(
  scene: Scene,
  spec: { readonly color: string; readonly mode: Layer['mode'] },
): Scene {
  if (scene.layers.some((layer) => layer.color === spec.color)) return scene;
  return addLayer(scene, createLayer({ id: spec.color, color: spec.color, mode: spec.mode }));
}

function layerSpecsForObject(
  object: SceneObject,
): ReadonlyArray<{ readonly color: string; readonly mode: Layer['mode'] }> {
  if (object.kind === 'raster-image') return [{ color: object.color, mode: 'image' }];
  // Relief layers are CNC-keyed; the laser mode field is inert for them.
  if (object.kind === 'relief') return [{ color: object.color, mode: 'line' }];
  const mode =
    object.kind === 'traced-image' &&
    object.traceMode !== 'centerline' &&
    object.traceMode !== 'edge'
      ? 'fill'
      : 'line';
  return object.paths.map((path) => ({ color: path.color, mode }));
}

function cloneSceneObject(object: SceneObject): SceneObject {
  return structuredClone(object) as SceneObject;
}

function cloneLayer(layer: Layer): Layer {
  return structuredClone(layer) as Layer;
}
