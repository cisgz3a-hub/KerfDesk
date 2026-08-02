import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ASSET_PAGE_BYTES,
  stageAssetPages,
  type PagedAssetManifest,
  type PagedAssetSink,
} from './paged-asset-stager';

const MIB = 1024 * 1024;
const QUALIFICATION_BYTES = 256 * MIB;

class VirtualBlob {
  readonly type = 'application/octet-stream';
  readonly sliceSizes: number[] = [];

  constructor(readonly size: number) {}

  slice(start = 0, end = this.size, contentType = ''): Blob {
    const size = Math.max(0, Math.min(this.size, end) - Math.min(this.size, start));
    this.sliceSizes.push(size);
    return {
      size,
      type: contentType,
      slice: () => {
        throw new Error('nested slice is not used');
      },
    } as unknown as Blob;
  }
}

class RecordingSink implements PagedAssetSink {
  readonly pages: Array<{ readonly index: number; readonly size: number }> = [];
  readonly manifests: PagedAssetManifest[] = [];
  readonly aborted: string[] = [];
  inFlight = 0;
  maximumInFlight = 0;

  async begin(manifest: PagedAssetManifest): Promise<void> {
    this.manifests.push(manifest);
  }

  async writePage(_assetId: string, index: number, page: Blob): Promise<void> {
    this.inFlight += 1;
    this.maximumInFlight = Math.max(this.maximumInFlight, this.inFlight);
    await Promise.resolve();
    this.pages.push({ index, size: page.size });
    this.inFlight -= 1;
  }

  async commit(manifest: PagedAssetManifest): Promise<void> {
    this.manifests.push(manifest);
  }

  async abort(assetId: string): Promise<void> {
    this.aborted.push(assetId);
  }
}

describe('stageAssetPages', () => {
  it('visits a virtual 256 MiB source in fixed slices with one write in flight', async () => {
    const source = new VirtualBlob(QUALIFICATION_BYTES);
    const sink = new RecordingSink();
    const progress = vi.fn();

    const manifest = await stageAssetPages(
      source as unknown as Blob,
      {
        assetId: 'asset-large',
        sourceName: 'large.png',
        createdAtEpochMs: 1,
        onProgress: progress,
      },
      sink,
    );

    expect(source.sliceSizes).toHaveLength(256);
    expect(Math.max(...source.sliceSizes)).toBe(DEFAULT_ASSET_PAGE_BYTES);
    expect(sink.pages).toHaveLength(256);
    expect(sink.maximumInFlight).toBe(1);
    expect(manifest).toMatchObject({
      assetId: 'asset-large',
      byteLength: QUALIFICATION_BYTES,
      pageCount: 256,
      state: 'ready',
    });
    expect(progress).toHaveBeenLastCalledWith({
      phase: 'persisting',
      bytesProcessed: QUALIFICATION_BYTES,
      totalBytes: QUALIFICATION_BYTES,
      pageIndex: 255,
      pageCount: 256,
    });
  });

  it('writes an exact final partial page', async () => {
    const source = new VirtualBlob(DEFAULT_ASSET_PAGE_BYTES + 7);
    const sink = new RecordingSink();

    await stageAssetPages(
      source as unknown as Blob,
      { assetId: 'asset-partial', sourceName: 'partial.bin', createdAtEpochMs: 2 },
      sink,
    );

    expect(sink.pages).toEqual([
      { index: 0, size: DEFAULT_ASSET_PAGE_BYTES },
      { index: 1, size: 7 },
    ]);
  });

  it('aborts staging without committing when cancellation arrives', async () => {
    const source = new VirtualBlob(4 * DEFAULT_ASSET_PAGE_BYTES);
    const sink = new RecordingSink();
    const controller = new AbortController();
    const originalWrite = sink.writePage.bind(sink);
    sink.writePage = async (assetId, index, page) => {
      await originalWrite(assetId, index, page);
      if (index === 1) controller.abort();
    };

    await expect(
      stageAssetPages(
        source as unknown as Blob,
        {
          assetId: 'asset-cancel',
          sourceName: 'cancel.bin',
          createdAtEpochMs: 3,
          signal: controller.signal,
        },
        sink,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(sink.aborted).toEqual(['asset-cancel']);
    expect(sink.manifests).toHaveLength(1);
  });

  it('aborts staging when a page write fails', async () => {
    const source = new VirtualBlob(DEFAULT_ASSET_PAGE_BYTES);
    const sink = new RecordingSink();
    sink.writePage = vi.fn(async () => {
      throw new Error('quota fixture');
    });

    await expect(
      stageAssetPages(
        source as unknown as Blob,
        { assetId: 'asset-failed', sourceName: 'failed.bin', createdAtEpochMs: 4 },
        sink,
      ),
    ).rejects.toThrow('quota fixture');
    expect(sink.aborted).toEqual(['asset-failed']);
  });
});
