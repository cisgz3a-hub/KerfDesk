// Resolve the FULL source bytes of a raster, embedded or page-backed.
//
// hydratePagedRasterImage substitutes the bounded thumbnail for `dataUrl`,
// which is right for drawing and wrong for editing: Image Studio and Trace
// would silently operate on a preview-sized image and bake that back as the
// object's pixels. A page-backed raster still holds its original bytes under
// imageAsset.sourceAssetId, so read those instead of the stand-in.
import type { RasterImage } from '../../core/scene';
import { dataUrlToFile } from '../trace/image-loader';
import { IndexedDbPagedAssetRepository } from './paged-asset-indexeddb';
import type { PagedRasterAssetReader } from './paged-raster-hydration';

/** Read a raster's original source bytes as a File, whichever representation it uses. */
export async function readRasterSourceFile(
  image: RasterImage,
  filename: string,
  repository: PagedRasterAssetReader = new IndexedDbPagedAssetRepository(),
  signal?: AbortSignal,
): Promise<File> {
  const asset = image.imageAsset;
  if (asset === undefined) {
    if (image.dataUrl === undefined) {
      throw new Error(`${filename} has neither embedded pixels nor a page-backed source.`);
    }
    return dataUrlToFile(image.dataUrl, filename);
  }
  const chunks: BlobPart[] = [];
  let totalBytes = 0;
  for await (const chunk of repository.readAssetChunks(asset.sourceAssetId, signal)) {
    // Copy each chunk: the reader may hand back a view over a buffer it reuses
    // for the next read, and File() would then see mutated bytes.
    chunks.push(new Uint8Array(chunk).slice());
    totalBytes += chunk.byteLength;
  }
  if (totalBytes !== asset.sourceByteLength) {
    throw new Error(
      `Page-backed raster source is ${totalBytes} bytes; the manifest expects ${asset.sourceByteLength}.`,
    );
  }
  return new File(chunks, filename, { type: asset.sourceMimeType });
}
