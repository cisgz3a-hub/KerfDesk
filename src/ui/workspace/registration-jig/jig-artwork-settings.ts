import {
  objectOperationSettingsForLayer,
  projectObjectOperationSettings,
} from '../../../core/scene/object-operation-settings';
import {
  createArtworkOperation,
  isRegistrationBox,
  REGISTRATION_LAYER_ID,
  replaceSceneObjectOperationBinding,
  sceneObjectHasVisibleLayer,
  sceneObjectUsesOperation,
  type Layer,
  type Scene,
  type SceneObject,
} from '../../../core/scene';
import { selectedJigIds, type JigDraft } from './jig-editor-session';

export type JigArtworkSettingsPatch = Partial<
  Pick<
    Layer,
    | 'speed'
    | 'power'
    | 'passes'
    | 'hatchSpacingMm'
    | 'hatchAngleDeg'
    | 'fillStyle'
    | 'fillCrossHatch'
  >
> & { readonly mode?: 'line' | 'fill' };

function editableArtwork(draft: JigDraft): ReadonlyArray<SceneObject> {
  if (draft.project.machine?.kind === 'cnc') return [];
  const selected = selectedJigIds(draft);
  return draft.project.scene.objects.filter(
    (object) =>
      selected.has(object.id) &&
      !isRegistrationBox(object) &&
      object.kind !== 'raster-image' &&
      object.kind !== 'relief' &&
      object.locked !== true &&
      sceneObjectHasVisibleLayer(draft.project.scene, object),
  );
}

export function jigArtworkOperations(draft: JigDraft): ReadonlyArray<Layer> {
  return artworkOperations(normalizeOverrides(draft));
}

function artworkOperations(draft: JigDraft): ReadonlyArray<Layer> {
  const objects = editableArtwork(draft);
  return draft.project.scene.layers.filter(
    (layer) =>
      layer.id !== REGISTRATION_LAYER_ID &&
      layer.visible &&
      layer.mode !== 'image' &&
      objects.some((object) => sceneObjectUsesOperation(object, layer)),
  );
}

/** Edit one operation on selected artwork only. A shared operation is copied
 * before rebinding so unselected pieces keep their original burn settings. */
export function applyJigArtworkSettings(
  initial: JigDraft,
  operationId: string,
  patch: JigArtworkSettingsPatch,
): JigDraft {
  const draft = normalizeOverrides(initial);
  const source = artworkOperations(draft).find((layer) => layer.id === operationId);
  if (source === undefined) return initial;
  const normalized = normalizeSettings(patch, draft.project.device.maxFeed);
  if (normalized.power !== undefined) {
    normalized.minPower = Math.min(source.minPower, normalized.power);
  }
  if (Object.entries(normalized).every(([key, value]) => source[key as keyof Layer] === value)) {
    return initial;
  }
  const scene = draft.project.scene;
  const affected = editableArtwork(draft).filter((object) =>
    sceneObjectUsesOperation(object, source),
  );
  const ids = new Set(affected.map((object) => object.id));
  const shared = scene.objects.some(
    (object) => !ids.has(object.id) && sceneObjectUsesOperation(object, source),
  );
  const first = affected[0];
  if (first === undefined) return initial;
  const seed = shared ? createArtworkOperation(scene, first).operation : source;
  const updated: Layer = {
    ...source,
    ...normalized,
    id: seed.id,
    name: seed.name,
    color: seed.color,
  };
  const objects = shared
    ? scene.objects.map((object) =>
        ids.has(object.id)
          ? replaceSceneObjectOperationBinding(object, source.id, updated.id, scene.layers)
          : object,
      )
    : scene.objects;
  const layers = shared
    ? [...scene.layers, updated]
    : scene.layers.map((layer) => (layer.id === source.id ? updated : layer));
  return finishOperationEdit(draft, { ...scene, objects, layers }, source, updated);
}

function finishOperationEdit(
  draft: JigDraft,
  scene: Scene,
  source: Layer,
  updated: Layer,
): JigDraft {
  const existingSnapshot =
    draft.registrationArtworkOutputSnapshot ?? draft.project.registrationArtworkOutputSnapshot;
  const snapshot =
    source.id !== updated.id && existingSnapshot !== undefined && existingSnapshot !== null
      ? { ...existingSnapshot, [updated.id]: existingSnapshot[source.id] ?? source.output }
      : existingSnapshot;
  const project = {
    ...draft.project,
    scene,
    ...(snapshot == null ? {} : { registrationArtworkOutputSnapshot: snapshot }),
  };
  return { ...draft, project, registrationArtworkOutputSnapshot: snapshot ?? null };
}

/** Promote legacy object-wide overrides to dedicated operations before showing
 * values. Every binding is preserved, including secondary/path-specific ones. */
function normalizeOverrides(initial: JigDraft): JigDraft {
  let draft = initial;
  for (const original of editableArtwork(initial)) {
    if (original.operationOverride === undefined) continue;
    const override = objectOperationSettingsForLayer(
      projectObjectOperationSettings(original.operationOverride),
    );
    const sourceScene = draft.project.scene;
    let scene = sourceScene;
    let object = original;
    let snapshot =
      draft.registrationArtworkOutputSnapshot ?? draft.project.registrationArtworkOutputSnapshot;
    for (const source of sourceScene.layers) {
      if (!sceneObjectUsesOperation(original, source) || source.id === REGISTRATION_LAYER_ID)
        continue;
      const seed = createArtworkOperation(scene, original).operation;
      const operation = {
        ...source,
        ...override,
        id: seed.id,
        name: seed.name,
        color: seed.color,
        subLayers: source.subLayers.map((subLayer) => ({
          ...subLayer,
          settings: { ...subLayer.settings, ...override },
        })),
      };
      object = replaceSceneObjectOperationBinding(
        object,
        source.id,
        operation.id,
        sourceScene.layers,
      );
      scene = { ...scene, layers: [...scene.layers, operation] };
      if (snapshot != null) {
        snapshot = { ...snapshot, [operation.id]: snapshot[source.id] ?? source.output };
      }
    }
    const { operationOverride: _override, ...clean } = object;
    scene = {
      ...scene,
      objects: scene.objects.map((candidate) =>
        candidate.id === original.id ? (clean as SceneObject) : candidate,
      ),
    };
    draft = {
      ...draft,
      project: {
        ...draft.project,
        scene,
        ...(snapshot == null ? {} : { registrationArtworkOutputSnapshot: snapshot }),
      },
      registrationArtworkOutputSnapshot: snapshot ?? null,
    };
  }
  return draft;
}

function normalizeSettings(
  patch: JigArtworkSettingsPatch,
  maxFeed: number,
): { -readonly [Key in keyof Layer]?: Layer[Key] } {
  const result: { -readonly [Key in keyof Layer]?: Layer[Key] } = {};
  if (patch.mode === 'line' || patch.mode === 'fill') result.mode = patch.mode;
  const limits = {
    speed: [1, Number.isFinite(maxFeed) && maxFeed > 0 ? maxFeed : Infinity],
    power: [0, 100],
    passes: [1, Infinity],
    hatchSpacingMm: [0.05, 10],
    hatchAngleDeg: [0, 180],
  } as const;
  for (const key of Object.keys(limits) as Array<keyof typeof limits>) {
    const value = patch[key];
    if (value === undefined || !Number.isFinite(value)) continue;
    const [min, max] = limits[key];
    const bounded = Math.max(min, Math.min(max, value));
    result[key] = key === 'passes' ? Math.floor(bounded) : bounded;
  }
  if (patch.fillStyle !== undefined && ['scanline', 'offset', 'island'].includes(patch.fillStyle)) {
    result.fillStyle = patch.fillStyle;
  }
  if (typeof patch.fillCrossHatch === 'boolean') result.fillCrossHatch = patch.fillCrossHatch;
  return result;
}
