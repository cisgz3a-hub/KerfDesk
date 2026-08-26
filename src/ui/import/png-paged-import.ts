import { IndexedDbPagedAssetRepository } from './paged-asset-indexeddb';
import { PagedAssetByteWriter } from './paged-asset-byte-writer';
import { stageAssetStream } from './paged-asset-stream-stager';
import {
  stageAssetPages,
  type PagedAssetManifest,
  type PagedAssetProgress,
} from './paged-asset-stager';
import { decodeIncrementalPngToLuma, type IncrementalPngProgress } from './png-incremental-decoder';
import { PngThumbnailBuilder, type PngImportThumbnail } from './png-thumbnail';
import type { ImageDensity } from '../common/image-density';

export type PngPagedImportProgress =
  | (Omit<PagedAssetProgress, 'phase'> & { readonly phase: 'persisting-source' })
  | IncrementalPngProgress
  | {
      readonly phase: 'persisting-luma';
      readonly bytesProcessed: number;
      readonly totalBytes: number;
    };

export type PngPagedImportOptions = {
  readonly assetId: string;
  readonly lumaAssetId: string;
  readonly sourceName: string;
  readonly createdAtEpochMs: number;
  readonly maxEdge: number;
  readonly maxPixels: number;
  readonly sourcePageBytes?: number;
  readonly outputPageBytes?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: PngPagedImportProgress) => void;
};

export type PngPagedImportResult =
  | {
      readonly kind: 'ok';
      readonly width: number;
      readonly height: number;
      readonly sampledWidth: number;
      readonly sampledHeight: number;
      readonly density: ImageDensity | null;
      readonly sourceManifest: PagedAssetManifest;
      readonly lumaManifest: PagedAssetManifest;
      readonly thumbnail: PngImportThumbnail;
    }
  | { readonly kind: 'legacy-fallback'; readonly reason: string };

export type PngStreamSource = {
  readonly byteLength: number;
  readonly mimeType: string;
};

export async function importPngToPagedAssets(
  source: Blob,
  options: PngPagedImportOptions,
  repository = new IndexedDbPagedAssetRepository(),
): Promise<PngPagedImportResult> {
  const sourceManifest = await stageAssetPages(
    source,
    {
      assetId: options.assetId,
      sourceName: options.sourceName,
      createdAtEpochMs: options.createdAtEpochMs,
      ...(options.sourcePageBytes === undefined ? {} : { pageBytes: options.sourcePageBytes }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onProgress: (progress) => {
        options.onProgress?.({ ...progress, phase: 'persisting-source' });
      },
    },
    repository,
  );
  return decodeStagedPng(sourceManifest, options, repository);
}

export async function importPngStreamToPagedAssets(
  stream: ReadableStream<Uint8Array>,
  source: PngStreamSource,
  options: PngPagedImportOptions,
  repository = new IndexedDbPagedAssetRepository(),
): Promise<PngPagedImportResult> {
  const sourceManifest = await stageAssetStream(
    stream,
    {
      assetId: options.assetId,
      sourceName: options.sourceName,
      mimeType: source.mimeType,
      byteLength: source.byteLength,
      createdAtEpochMs: options.createdAtEpochMs,
      ...(options.sourcePageBytes === undefined ? {} : { pageBytes: options.sourcePageBytes }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onProgress: (progress) => {
        options.onProgress?.({ ...progress, phase: 'persisting-source' });
      },
    },
    repository,
  );
  return decodeStagedPng(sourceManifest, options, repository);
}

async function decodeStagedPng(
  sourceManifest: PagedAssetManifest,
  options: PngPagedImportOptions,
  repository: IndexedDbPagedAssetRepository,
): Promise<PngPagedImportResult> {
  let lumaWriter: PagedAssetByteWriter | null = null;
  let thumbnailBuilder: PngThumbnailBuilder | null = null;
  try {
    const decoded = await decodeIncrementalPngToLuma(
      repository.readAssetChunks(options.assetId, options.signal),
      {
        maxEdge: options.maxEdge,
        maxPixels: options.maxPixels,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        onProgress: (progress) => options.onProgress?.(progress),
        onHeader: async (header) => {
          thumbnailBuilder = new PngThumbnailBuilder(header.sampledWidth, header.sampledHeight);
          lumaWriter = await PagedAssetByteWriter.create(repository, {
            assetId: options.lumaAssetId,
            sourceName: `${options.sourceName}.luma`,
            mimeType: 'application/x-curvedesk-luma',
            byteLength: header.sampledWidth * header.sampledHeight,
            createdAtEpochMs: options.createdAtEpochMs,
            ...(options.outputPageBytes === undefined
              ? {}
              : { pageBytes: options.outputPageBytes }),
            onProgress: (bytesProcessed, totalBytes) => {
              options.onProgress?.({
                phase: 'persisting-luma',
                bytesProcessed,
                totalBytes,
              });
            },
          });
        },
        onRow: async (row) => {
          requireThumbnailBuilder(thumbnailBuilder).accept(row);
          await requireLumaWriter(lumaWriter).write(row);
        },
      },
    );
    if (decoded.kind === 'legacy-fallback') {
      await cleanup(lumaWriter, repository, options);
      return decoded;
    }
    const lumaManifest = await requireLumaWriter(lumaWriter).finish();
    const thumbnail = requireThumbnailBuilder(thumbnailBuilder).finish();
    return { ...decoded, sourceManifest, lumaManifest, thumbnail };
  } catch (error) {
    try {
      await cleanup(lumaWriter, repository, options);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'PNG import failed and staging cleanup also failed.',
      );
    }
    throw error;
  }
}

function requireThumbnailBuilder(builder: PngThumbnailBuilder | null): PngThumbnailBuilder {
  if (builder === null) throw new Error('PNG thumbnail builder was not initialized.');
  return builder;
}

function requireLumaWriter(writer: PagedAssetByteWriter | null): PagedAssetByteWriter {
  if (writer === null) throw new Error('PNG luma writer was not initialized.');
  return writer;
}

async function cleanup(
  lumaWriter: PagedAssetByteWriter | null,
  repository: IndexedDbPagedAssetRepository,
  options: PngPagedImportOptions,
): Promise<void> {
  const cleanupErrors: unknown[] = [];
  try {
    await lumaWriter?.abort();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await repository.abort(options.assetId);
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'PNG staging cleanup failed.');
  }
}
