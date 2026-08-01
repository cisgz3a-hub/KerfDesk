export const DEFAULT_ASSET_PAGE_BYTES = 1024 * 1024;
const PAGED_ASSET_SCHEMA_VERSION = 1;

export type PagedAssetManifest = {
  readonly schemaVersion: typeof PAGED_ASSET_SCHEMA_VERSION;
  readonly assetId: string;
  readonly sourceName: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly writtenByteLength: number;
  readonly pageBytes: number;
  readonly pageCount: number;
  readonly createdAtEpochMs: number;
  readonly state: 'staging' | 'ready';
  readonly stagingLockProtection?: 'web-lock';
  readonly stagingExpiresAtEpochMs?: number;
};

export type PagedAssetProgress = {
  readonly phase: 'persisting';
  readonly bytesProcessed: number;
  readonly totalBytes: number;
  readonly pageIndex: number;
  readonly pageCount: number;
};

export type StageAssetPagesOptions = {
  readonly assetId: string;
  readonly sourceName: string;
  readonly createdAtEpochMs: number;
  readonly pageBytes?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: PagedAssetProgress) => void;
};

export interface PagedAssetSink {
  begin(manifest: PagedAssetManifest): Promise<void>;
  writePage(assetId: string, index: number, page: Blob): Promise<void>;
  commit(manifest: PagedAssetManifest): Promise<void>;
  abort(assetId: string): Promise<void>;
}

export async function stageAssetPages(
  source: Blob,
  options: StageAssetPagesOptions,
  sink: PagedAssetSink,
): Promise<PagedAssetManifest> {
  const pageBytes = options.pageBytes ?? DEFAULT_ASSET_PAGE_BYTES;
  assertPositiveInteger(pageBytes, 'pageBytes');
  const pageCount = Math.ceil(source.size / pageBytes);
  const staging = manifestFor(source, options, pageBytes, pageCount, 'staging');
  await sink.begin(staging);
  try {
    let bytesProcessed = 0;
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      throwIfCancelled(options.signal);
      const start = pageIndex * pageBytes;
      const end = Math.min(source.size, start + pageBytes);
      const page = source.slice(start, end, source.type);
      if (page.size !== end - start) {
        throw new Error(`Asset page ${pageIndex} has ${page.size} bytes; expected ${end - start}.`);
      }
      await sink.writePage(options.assetId, pageIndex, page);
      bytesProcessed += page.size;
      options.onProgress?.({
        phase: 'persisting',
        bytesProcessed,
        totalBytes: source.size,
        pageIndex,
        pageCount,
      });
    }
    throwIfCancelled(options.signal);
    const ready = {
      ...staging,
      writtenByteLength: source.size,
      state: 'ready',
    } as const;
    await sink.commit(ready);
    return ready;
  } catch (error) {
    await sink.abort(options.assetId);
    throw error;
  }
}

function manifestFor(
  source: Blob,
  options: StageAssetPagesOptions,
  pageBytes: number,
  pageCount: number,
  state: PagedAssetManifest['state'],
): PagedAssetManifest {
  return {
    schemaVersion: PAGED_ASSET_SCHEMA_VERSION,
    assetId: options.assetId,
    sourceName: options.sourceName,
    mimeType: source.type,
    byteLength: source.size,
    writtenByteLength: state === 'ready' ? source.size : 0,
    pageBytes,
    pageCount,
    createdAtEpochMs: options.createdAtEpochMs,
    state,
  };
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  const error = new Error('asset staging cancelled');
  error.name = 'AbortError';
  throw error;
}
