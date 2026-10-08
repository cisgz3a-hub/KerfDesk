import type { Project, RasterImage, SceneObject } from '../../core/scene';
import { findFontEntry } from '../../core/text';
import { deserializeProject, serializeProject } from '../../io/project';
import { IndexedDbPagedAssetRepository } from '../import/paged-asset-indexeddb';
import {
  mapProjectAssetArchives,
  projectAssetArchiveBudget,
  readProjectAssetArchive,
  type ProjectAssetArchiveBudget,
} from '../import/project-asset-archives';
import {
  encodePagedAssetBase64,
  hydratePagedRasterImage,
  type PagedRasterAssetReader,
} from '../import/paged-raster-hydration';

export function projectNeedsPortableAssets(project: Project): boolean {
  return (
    (project.sheetBook?.inactive.length ?? 0) > 0 ||
    project.productionManifest !== undefined ||
    (project.arrayLayouts?.length ?? 0) > 0 ||
    project.scene.objects.some(
      (object) => object.kind === 'raster-image' && object.imageAsset !== undefined,
    )
  );
}

/** Portable files own original image pixels AND engraving luma, never local asset IDs. */
export async function portableProjectAssets(
  project: Project,
  reader: PagedRasterAssetReader = new IndexedDbPagedAssetRepository(),
  signal?: AbortSignal,
): Promise<Project> {
  return portableProjectDocument(project, reader, signal, projectAssetArchiveBudget());
}

async function portableProjectDocument(
  project: Project,
  reader: PagedRasterAssetReader,
  signal: AbortSignal | undefined,
  budget: ProjectAssetArchiveBudget,
): Promise<Project> {
  const active = await portableSceneAssets(project, reader, signal);
  return mapProjectAssetArchives(active, async (entry) => {
    if (signal?.aborted === true) throw new Error('Saving artwork was cancelled.');
    readProjectAssetArchive(entry, budget);
    const parsed = deserializeProject(entry.json);
    if (parsed.kind !== 'ok') throw new Error(`${entry.label} cannot be opened for saving.`);
    const json = serializeProject(
      await portableProjectDocument(parsed.project, reader, signal, budget),
    );
    budget.remainingChars -= Math.max(0, json.length - entry.json.length);
    if (budget.remainingChars < 0)
      throw new Error('Embedded workflow archives exceed the 50 million character copy budget.');
    return json;
  });
}

async function portableSceneAssets(
  project: Project,
  reader: PagedRasterAssetReader,
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
