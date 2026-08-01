import { PagedAssetByteWriter } from './paged-asset-byte-writer';
import type { PagedAssetManifest, PagedAssetProgress, PagedAssetSink } from './paged-asset-stager';
import { DEFAULT_ASSET_PAGE_BYTES } from './paged-asset-stager';

export type StageAssetStreamOptions = {
  readonly assetId: string;
  readonly sourceName: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly createdAtEpochMs: number;
  readonly pageBytes?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: PagedAssetProgress) => void;
};

export async function stageAssetStream(
  stream: ReadableStream<Uint8Array>,
  options: StageAssetStreamOptions,
  sink: PagedAssetSink,
): Promise<PagedAssetManifest> {
  const pageBytes = options.pageBytes ?? DEFAULT_ASSET_PAGE_BYTES;
  const pageCount = Math.ceil(options.byteLength / pageBytes);
  const writer = await PagedAssetByteWriter.create(sink, {
    assetId: options.assetId,
    sourceName: options.sourceName,
    mimeType: options.mimeType,
    byteLength: options.byteLength,
    createdAtEpochMs: options.createdAtEpochMs,
    ...(options.pageBytes === undefined ? {} : { pageBytes: options.pageBytes }),
    onProgress: (bytesProcessed, totalBytes) => {
      options.onProgress?.({
        phase: 'persisting',
        bytesProcessed,
        totalBytes,
        pageIndex: Math.max(0, Math.ceil(bytesProcessed / pageBytes) - 1),
        pageCount,
      });
    },
  });
  const reader = stream.getReader();
  const handleAbort = (): void => {
    void reader.cancel(options.signal?.reason);
  };
  options.signal?.addEventListener('abort', handleAbort, { once: true });
  try {
    while (true) {
      throwIfAborted(options.signal);
      const next = await reader.read();
      throwIfAborted(options.signal);
      if (next.done === true) break;
      if (!isByteChunk(next.value)) {
        throw new Error('Paged asset source stream produced a non-byte chunk.');
      }
      await writer.write(
        new Uint8Array(next.value.buffer, next.value.byteOffset, next.value.byteLength),
      );
    }
    return await writer.finish();
  } catch (error) {
    try {
      await writer.abort();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Stream staging failed and cleanup also failed.',
      );
    }
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', handleAbort);
    reader.releaseLock();
  }
}

function isByteChunk(value: ArrayBufferView): value is Uint8Array {
  return ArrayBuffer.isView(value) && 'BYTES_PER_ELEMENT' in value && value.BYTES_PER_ELEMENT === 1;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  const error = new Error('Paged asset stream staging cancelled.');
  error.name = 'AbortError';
  throw error;
}
