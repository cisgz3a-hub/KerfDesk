import { type Scene } from '../core/scene/Scene';
import { type ImageGeometry, type SceneObject } from '../core/scene/SceneObject';
import { hasImage } from './ImageStore';

const INDEXEDDB_SRC_PREFIX = 'indexeddb://';

export interface ImageReferenceStore {
  hasImage: (id: string) => Promise<boolean>;
}

export interface MissingImageReference {
  readonly objectId: string;
  readonly objectName: string;
  readonly layerId: string;
  readonly layerName: string;
  readonly src: string;
  readonly imageId: string;
}

export interface ImageReferenceValidationResult {
  readonly checked: number;
  readonly missing: readonly MissingImageReference[];
}

export function isIndexedDbImageReference(src: unknown): src is string {
  return typeof src === 'string' && src.startsWith(INDEXEDDB_SRC_PREFIX);
}

function indexedDbImageId(src: string): string {
  return src.slice(INDEXEDDB_SRC_PREFIX.length);
}

function defaultStore(): ImageReferenceStore {
  return { hasImage };
}

export async function validateImageReferences(
  scene: Scene,
  store: ImageReferenceStore = defaultStore(),
): Promise<ImageReferenceValidationResult> {
  const layerNames = new Map(scene.layers.map(layer => [layer.id, layer.name || layer.id]));
  const missing: MissingImageReference[] = [];
  let checked = 0;

  for (const object of scene.objects) {
    if (object.geometry.type !== 'image') continue;
    const src = object.geometry.src;
    if (!isIndexedDbImageReference(src)) continue;

    checked++;
    const imageId = indexedDbImageId(src);
    let exists = false;
    try {
      exists = await store.hasImage(imageId);
    } catch {
      exists = false;
    }
    if (exists) continue;

    missing.push({
      objectId: object.id,
      objectName: object.name || object.id,
      layerId: object.layerId,
      layerName: layerNames.get(object.layerId) ?? object.layerId,
      src,
      imageId,
    });
  }

  return { checked, missing };
}

export function applyMissingImageReferenceState(
  scene: Scene,
  missing: readonly MissingImageReference[],
): Scene {
  if (missing.length === 0) return scene;
  const missingByObjectId = new Map(missing.map(item => [item.objectId, item]));
  let changed = false;

  const objects = scene.objects.map((object): SceneObject => {
    if (object.geometry.type !== 'image') return object;
    const missingRef = missingByObjectId.get(object.id);
    const existingMissing = object.geometry.missingSource === true;
    if (!missingRef && !existingMissing) return object;

    changed = true;
    const geometry: ImageGeometry = {
      ...object.geometry,
      missingSource: missingRef != null,
      missingSourceId: missingRef?.imageId,
    };
    return { ...object, geometry };
  });

  return changed ? { ...scene, objects } : scene;
}

export async function validateAndAnnotateImageReferences(
  scene: Scene,
  store: ImageReferenceStore = defaultStore(),
): Promise<{ scene: Scene; validation: ImageReferenceValidationResult }> {
  const validation = await validateImageReferences(scene, store);
  return {
    scene: applyMissingImageReferenceState(scene, validation.missing),
    validation,
  };
}

export function formatMissingImageReferenceReport(
  validation: ImageReferenceValidationResult,
): string {
  const count = validation.missing.length;
  if (count === 0) return '';

  const layerCounts = new Map<string, number>();
  for (const item of validation.missing) {
    const key = item.layerName || item.layerId;
    layerCounts.set(key, (layerCounts.get(key) ?? 0) + 1);
  }

  const lines = [
    `This project references ${count} image object${count === 1 ? '' : 's'} that could not be found.`,
    '',
    ...Array.from(layerCounts.entries()).map(([layerName, layerCount]) =>
      `- ${layerCount} image object${layerCount === 1 ? '' : 's'} on layer "${layerName}" has missing source data.`,
    ),
    '',
    'These objects will appear as missing-image placeholders until you re-import the images.',
  ];

  return lines.join('\n');
}
