import type { Project, RasterImage } from '../../core/scene';
import type { PagedAssetManifest } from './paged-asset-stager';
import { IndexedDbPagedAssetRepository } from './paged-asset-indexeddb';

export type PagedRasterAssetReader = {
  readManifest(assetId: string): Promise<PagedAssetManifest | null>;
  readAssetChunks(
    assetId: string,
    signal?: AbortSignal,
  ): AsyncIterable<Uint8Array<ArrayBufferLike>>;
  acquireReadLease?(assetIds: readonly string[], leaseId: string): Promise<void>;
  releaseReadLease?(assetIds: readonly string[], leaseId: string): Promise<void>;
};

export function projectHasPagedRasterAssets(project: Project): boolean {
  return project.scene.objects.some(
    (object) => object.kind === 'raster-image' && object.imageAsset !== undefined,
  );
}

export async function hydratePagedRasterProject(
  project: Project,
  repository: PagedRasterAssetReader = new IndexedDbPagedAssetRepository(),
  signal?: AbortSignal,
): Promise<Project> {
  if (!projectHasPagedRasterAssets(project)) return project;
  const objects = await Promise.all(
    project.scene.objects.map(async (object) =>
      object.kind === 'raster-image' && object.imageAsset !== undefined
        ? hydratePagedRasterImage(object, repository, signal)
        : object,
    ),
  );
  return { ...project, scene: { ...project.scene, objects } };
}

export async function hydratePagedRasterImage(
  image: RasterImage,
  repository: PagedRasterAssetReader = new IndexedDbPagedAssetRepository(),
  signal?: AbortSignal,
): Promise<RasterImage> {
  const asset = image.imageAsset;
  if (asset === undefined) return image;
  const assetIds = [asset.lumaAssetId];
  if (repository.acquireReadLease === undefined || repository.releaseReadLease === undefined) {
    return hydrateLeasedImage(image, repository, signal);
  }
  const leaseId = crypto.randomUUID();
  await repository.acquireReadLease(assetIds, leaseId);
  try {
    return await hydrateLeasedImage(image, repository, signal);
  } finally {
    await repository.releaseReadLease(assetIds, leaseId);
  }
}

async function hydrateLeasedImage(
  image: RasterImage,
  repository: PagedRasterAssetReader,
  signal: AbortSignal | undefined,
): Promise<RasterImage> {
  const asset = image.imageAsset;
  if (asset === undefined) return image;
  const expectedBytes = image.pixelWidth * image.pixelHeight;
  if (
    asset.sampledWidth !== image.pixelWidth ||
    asset.sampledHeight !== image.pixelHeight ||
    asset.lumaByteLength !== expectedBytes
  ) {
    throw new Error(
      `Page-backed raster metadata expects ${expectedBytes} luma bytes but references ${asset.lumaByteLength}.`,
    );
  }
  const manifest = await repository.readManifest(asset.lumaAssetId);
  if (
    manifest?.state !== 'ready' ||
    manifest.assetId !== asset.lumaAssetId ||
    manifest.mimeType !== 'application/x-curvedesk-luma'
  ) {
    throw new Error('Page-backed raster luma asset is unavailable.');
  }
  if (
    manifest.byteLength !== asset.lumaByteLength ||
    manifest.writtenByteLength !== manifest.byteLength
  ) {
    throw new Error(
      `Page-backed raster luma manifest has ${manifest.byteLength} bytes; expected ${asset.lumaByteLength}.`,
    );
  }
  const lumaBase64 = await encodePagedAssetBase64(
    repository,
    asset.lumaAssetId,
    expectedBytes,
    signal,
  );
  const { imageAsset: _imageAsset, ...fields } = image;
  return {
    ...fields,
    dataUrl: asset.thumbnail.dataUrl,
    lumaBase64,
  };
}

/** Read one complete paged byte asset into the canonical base64 representation. */
export async function encodePagedAssetBase64(
  repository: PagedRasterAssetReader,
  assetId: string,
  expectedBytes: number,
  signal: AbortSignal | undefined,
): Promise<string> {
  const encoded: string[] = [];
  let carry = new Uint8Array();
  let totalBytes = 0;
  for await (const chunk of repository.readAssetChunks(assetId, signal)) {
    throwIfAborted(signal);
    totalBytes += chunk.byteLength;
    if (totalBytes > expectedBytes) {
      throw new Error(`Page-backed raster luma exceeds its expected ${expectedBytes} bytes.`);
    }
    const combined = new Uint8Array(carry.byteLength + chunk.byteLength);
    combined.set(carry);
    combined.set(chunk, carry.byteLength);
    const completeLength = combined.byteLength - (combined.byteLength % 3);
    appendBase64(encoded, combined.subarray(0, completeLength));
    carry = combined.slice(completeLength);
  }
  if (totalBytes !== expectedBytes) {
    throw new Error(`Page-backed raster luma has ${totalBytes} bytes; expected ${expectedBytes}.`);
  }
  appendBase64(encoded, carry);
  return encoded.join('');
}

function appendBase64(encoded: string[], bytes: Uint8Array): void {
  if (bytes.byteLength === 0) return;
  const binary: string[] = [];
  const chunkBytes = 0x6000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
    binary.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkBytes)));
  }
  encoded.push(btoa(binary.join('')));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  const error = new Error('Page-backed raster hydration cancelled.');
  error.name = 'AbortError';
  throw error;
}
