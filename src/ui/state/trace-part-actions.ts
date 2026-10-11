import { canonicalArtworkOrder } from '../../core/artwork-order';
import { designNodeOrder } from '../../core/scene/design-hierarchy-order';
import { sceneLayerVisibility, type Scene, type TracedImage } from '../../core/scene';
import type { AppState } from './store';
import { pushUndo } from './scene-mutations';
import { sceneLimitOverrun } from './scene-copy-room';
import { scopedSelectionProjectPatch } from './project-job-setup';
import { detachTracePartGeometry, isSingleTracePart } from './trace-part-geometry';
import { useToastStore } from './toast-store';

export type TracePartActions = {
  readonly detachTracePart: (
    objectId: string,
    pathIndex: number,
    subpathIndex: number,
  ) => string | null;
  readonly selectTracePart: (id: string | null, options?: { readonly toggle?: boolean }) => void;
};

type TracePartSet = (
  update: (state: AppState) => AppState | Partial<AppState>,
  onCommitted?: () => void,
) => unknown;

export function tracePartActions(set: TracePartSet): TracePartActions {
  return {
    detachTracePart: (objectId, pathIndex, subpathIndex) => {
      let result: string | null = null;
      let selectedId: string | null = null;
      let warning: string | null = null;
      set(
        (state) => {
          const object = editableTrace(state.project.scene, objectId);
          const path = object?.paths[pathIndex];
          if (object === null || path === undefined) return state;
          const layers = sceneLayerVisibility.lookup(state.project.scene.layers);
          if (!sceneLayerVisibility.resolvePath(object, path, layers).visible) return state;
          const partId = uniquePartId(state.project.scene, objectId);
          const split = detachTracePartGeometry(object, pathIndex, subpathIndex, partId);
          if (split === null) return state;
          if (split.remainder === null) {
            selectedId = objectId;
            return state;
          }
          warning = dependencyWarning(state.project.scene, objectId);
          if (warning !== null) return state;
          const scene = replaceWithPart(state.project.scene, split.remainder, split.part);
          warning = sceneLimitOverrun(
            state.project.scene,
            scene,
            'Delete some artwork before separating another part.',
          );
          if (warning !== null) return state;
          selectedId = partId;
          return {
            project: { ...state.project, scene },
            ...(state.pendingUndo === null
              ? {
                  undoStack: pushUndo(state.project, state.undoStack, 'Separate trace part'),
                  redoStack: [],
                }
              : {}),
            dirty: true,
          };
        },
        () => {
          result = selectedId;
          if (warning !== null) useToastStore.getState().pushToast(warning, 'warning');
        },
      );
      return result;
    },
    selectTracePart: (id, options = {}) =>
      set((state) => directPartSelection(state, id, options.toggle === true)),
  };
}

function editableTrace(scene: Scene, id: string): TracedImage | null {
  const object = scene.objects.find((candidate) => candidate.id === id);
  if (object?.kind !== 'traced-image' || object.locked === true) return null;
  return sceneLayerVisibility.hasObject(object, sceneLayerVisibility.lookup(scene.layers))
    ? object
    : null;
}

function dependencyWarning(scene: Scene, id: string): string | null {
  const mask = scene.objects.some(
    (object) => object.kind === 'raster-image' && object.imageMaskId === id,
  );
  const guide = scene.objects.some(
    (object) => object.kind === 'text' && object.pathText?.guideObjectId === id,
  );
  if (!mask && !guide) return null;
  // The retained ID would otherwise silently narrow a live mask or guide.
  // Releasing those relationships must be an explicit edit, even when hidden.
  const uses = [mask ? 'an image mask' : null, guide ? 'a text guide' : null].filter(Boolean);
  const steps = [
    mask
      ? 'Apply Crop Image to each masked image to keep its appearance, or use Remove Image Mask.'
      : null,
    guide ? "Turn off Path text in each linked text object's editor." : null,
  ].filter(Boolean);
  return `This trace is used as ${uses.join(' and ')}. Before separating its parts: ${steps.join(' ')}`;
}

function replaceWithPart(scene: Scene, remainder: TracedImage, part: TracedImage): Scene {
  const expand = (id: string): ReadonlyArray<string> =>
    id === remainder.id ? [id, part.id] : [id];
  return {
    ...scene,
    objects: scene.objects.flatMap((object) =>
      object.id === remainder.id ? [remainder, part] : [object],
    ),
    groups: (scene.groups ?? []).map((group) => ({
      ...group,
      objectIds: group.objectIds.flatMap(expand),
    })),
    artworkOrder: canonicalArtworkOrder(scene).flatMap(expand),
    ...(scene.designTreeOrder === undefined
      ? {}
      : {
          designTreeOrder: designNodeOrder(scene).flatMap((ref) =>
            ref.kind === 'object' && ref.id === remainder.id
              ? [ref, { kind: 'object' as const, id: part.id }]
              : [ref],
          ),
        }),
  };
}

function uniquePartId(scene: Scene, sourceId: string): string {
  const ids = new Set(scene.objects.map((object) => object.id));
  for (let index = 1; index <= ids.size + 1; index += 1) {
    const id = `${sourceId}__part_${index}`;
    if (!ids.has(id)) return id;
  }
  return `${sourceId}__part_${crypto.randomUUID()}`;
}

function directPartSelection(
  state: AppState,
  id: string | null,
  toggle: boolean,
): AppState | Partial<AppState> {
  if (id !== null && editableTrace(state.project.scene, id) === null) return state;
  const current = toggle
    ? [
        ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
        ...state.additionalSelectedIds,
      ].filter((candidate) => {
        const object = editableTrace(state.project.scene, candidate);
        return object !== null && isSingleTracePart(object);
      })
    : [];
  const ids =
    id === null
      ? []
      : current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id];
  const [primary, ...additional] = ids;
  return {
    ...scopedSelectionProjectPatch(state, {
      selectedObjectId: primary ?? null,
      additionalSelectedIds: new Set(additional),
    }),
    selectedPathNode: null,
    selectedPathNodes: [],
    selectionReference: null,
  };
}
