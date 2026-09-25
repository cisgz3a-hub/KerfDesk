import type { Project, RasterImage, SceneObject } from '../../core/scene';
import { findFontEntry } from '../../core/text';
import { IndexedDbPagedAssetRepository } from '../import/paged-asset-indexeddb';
import {
  encodePagedAssetBase64,
  hydratePagedRasterImage,
  type PagedRasterAssetReader,
} from '../import/paged-raster-hydration';

/** Portable files own original image pixels AND engraving luma, never local asset IDs. */
export async function portableProjectAssets(
  project: Project,
  reader: PagedRasterAssetReader = new IndexedDbPagedAssetRepository(),
  signal?: AbortSignal,
): Promise<Project> {
  requireEditableFonts(project);
  const objects: SceneObject[] = [];
  for (const object of project.scene.objects) {
    if (signal?.aborted === true) throw new Error('Saving artwork was cancelled.');
    if (
      object.kind === 'raster-image' &&
      object.imageAsset === undefined &&
      !object.dataUrl?.startsWith('data:')
    ) {
      throw new Error(`Embed the original pixels for ${object.source} before saving this artwork.`);
    }
    objects.push(
      object.kind === 'raster-image' && object.imageAsset !== undefined
        ? await portableImage(object, reader, signal)
        : object,
    );
  }
  return { ...project, scene: { ...project.scene, objects } };
}

function requireEditableFonts(project: Project): void {
  for (const object of project.scene.objects) {
    if (object.kind !== 'text' || findFontEntry(object.fontKey) !== null) continue;
    if (!(project.embeddedFonts ?? []).some((font) => font.key === object.fontKey)) {
      throw new Error(`Embed the missing font "${object.fontKey}" before saving this artwork.`);
    }
  }
}

async function portableImage(
  image: RasterImage,
  reader: PagedRasterAssetReader,
  signal: AbortSignal | undefined,
): Promise<RasterImage> {
  const asset = image.imageAsset;
  if (asset === undefined) return image;
  const ids = [asset.sourceAssetId, asset.lumaAssetId];
  const lease = crypto.randomUUID();
  await reader.acquireReadLease?.(ids, lease);
  try {
    const source = await reader.readManifest(asset.sourceAssetId);
    if (
      source?.state !== 'ready' ||
      source.assetId !== asset.sourceAssetId ||
      source.byteLength !== asset.sourceByteLength ||
      source.writtenByteLength !== asset.sourceByteLength ||
      source.mimeType !== asset.sourceMimeType
    )
      throw new Error(`Original image pixels for ${image.source} are unavailable.`);
    const hydrated = await hydratePagedRasterImage(image, reader, signal);
    const original = await encodePagedAssetBase64(
      reader,
      asset.sourceAssetId,
      asset.sourceByteLength,
      signal,
    );
    return { ...hydrated, dataUrl: `data:${asset.sourceMimeType};base64,${original}` };
  } finally {
    await reader.releaseReadLease?.(ids, lease);
  }
}
