import { IDBFactory as FakeIDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeRgbPng } from '../../__fixtures__/perceptual/png';
import { IndexedDbPagedAssetRepository } from './paged-asset-indexeddb';
import { importPngStreamToPagedAssets, importPngToPagedAssets } from './png-paged-import';

describe('importPngToPagedAssets', () => {
  beforeEach(() => {
    vi.stubGlobal('Blob', NodeBlob);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes only from durable source pages and commits paged luma output', async () => {
    const repository = new IndexedDbPagedAssetRepository(new FakeIDBFactory(), FakeIDBKeyRange);
    const readChunks = vi.spyOn(repository, 'readAssetChunks');
    const png = encodeRgbPng(Uint8Array.of(255, 0, 0, 0, 255, 0), 2, 1);
    const progress = vi.fn();

    const result = await importPngToPagedAssets(
      new NodeBlob([png], { type: 'image/png' }) as Blob,
      {
        assetId: 'png-source',
        lumaAssetId: 'png-luma',
        sourceName: 'fixture.png',
        createdAtEpochMs: 1,
        maxEdge: 8,
        maxPixels: 64,
        sourcePageBytes: 7,
        outputPageBytes: 1,
        onProgress: progress,
      },
      repository,
    );

    expect(result).toMatchObject({
      kind: 'ok',
      width: 2,
      height: 1,
      sampledWidth: 2,
      sampledHeight: 1,
      sourceManifest: { assetId: 'png-source', state: 'ready' },
      lumaManifest: { assetId: 'png-luma', byteLength: 2, pageCount: 2, state: 'ready' },
      thumbnail: { width: 2, height: 1, mimeType: 'image/bmp' },
    });
    if (result.kind !== 'ok') throw new Error('expected qualified PNG');
    expect(result.thumbnail.bytes.byteLength).toBe(62);
    expect(readChunks).toHaveBeenCalledWith('png-source', undefined);
    await expect(repository.readPage('png-luma', 0)).resolves.toMatchObject({ size: 1 });
    await expect(repository.readPage('png-luma', 1)).resolves.toMatchObject({ size: 1 });
    const luma = [
      ...new Uint8Array(await (await repository.readPage('png-luma', 0))!.arrayBuffer()),
      ...new Uint8Array(await (await repository.readPage('png-luma', 1))!.arrayBuffer()),
    ];
    expect(luma).toEqual([76, 150]);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'persisting-source' }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'decoding' }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'persisting-luma' }));
  });

  it('stages a readable source with backpressure before decoding its durable pages', async () => {
    const repository = new IndexedDbPagedAssetRepository(new FakeIDBFactory(), FakeIDBKeyRange);
    const png = encodeRgbPng(Uint8Array.of(255, 0, 0, 0, 255, 0), 2, 1);
    const source = new NodeBlob([png], { type: 'image/png' }) as Blob;
    const result = await importPngStreamToPagedAssets(
      source.stream(),
      { byteLength: source.size, mimeType: source.type },
      {
        assetId: 'stream-source',
        lumaAssetId: 'stream-luma',
        sourceName: 'stream.png',
        createdAtEpochMs: 4,
        maxEdge: 8,
        maxPixels: 64,
        sourcePageBytes: 7,
      },
      repository,
    );

    expect(result).toMatchObject({
      kind: 'ok',
      sourceManifest: {
        assetId: 'stream-source',
        byteLength: source.size,
        state: 'ready',
      },
      lumaManifest: { assetId: 'stream-luma', byteLength: 2, state: 'ready' },
    });
  });

  it('cancels the active source stream and removes partial staging before rejection', async () => {
    const repository = new IndexedDbPagedAssetRepository(new FakeIDBFactory(), FakeIDBKeyRange);
    const controller = new AbortController();
    const cancelSource = vi.fn();
    let emitted = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(streamController) {
        if (emitted >= 4) {
          streamController.close();
          return;
        }
        streamController.enqueue(new Uint8Array(1024 * 1024));
        emitted += 1;
      },
      cancel: cancelSource,
    });

    await expect(
      importPngStreamToPagedAssets(
        source,
        { byteLength: 4 * 1024 * 1024, mimeType: 'image/png' },
        {
          assetId: 'stream-cancel-source',
          lumaAssetId: 'stream-cancel-luma',
          sourceName: 'stream-cancel.png',
          createdAtEpochMs: 5,
          maxEdge: 8,
          maxPixels: 64,
          onProgress: (progress) => {
            if (progress.phase === 'persisting-source') controller.abort();
          },
          signal: controller.signal,
        },
        repository,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(cancelSource).toHaveBeenCalledOnce();
    await expect(repository.readManifest('stream-cancel-source')).resolves.toBeNull();
    await expect(repository.readManifest('stream-cancel-luma')).resolves.toBeNull();
  });

  it('fails closed and removes the source manifest when a streamed page write fails', async () => {
    const repository = new IndexedDbPagedAssetRepository(new FakeIDBFactory(), FakeIDBKeyRange);
    repository.writePage = vi.fn(async () => {
      throw new Error('quota fixture');
    });
    const png = encodeRgbPng(Uint8Array.of(255, 0, 0), 1, 1);
    const source = new NodeBlob([png], { type: 'image/png' }) as Blob;

    await expect(
      importPngStreamToPagedAssets(
        source.stream(),
        { byteLength: source.size, mimeType: source.type },
        {
          assetId: 'stream-failed-source',
          lumaAssetId: 'stream-failed-luma',
          sourceName: 'stream-failed.png',
          createdAtEpochMs: 6,
          maxEdge: 8,
          maxPixels: 64,
          sourcePageBytes: 7,
        },
        repository,
      ),
    ).rejects.toThrow('quota fixture');

    await expect(repository.readManifest('stream-failed-source')).resolves.toBeNull();
    await expect(repository.readManifest('stream-failed-luma')).resolves.toBeNull();
  });

  it('fails closed under luma quota pressure and removes both ready source and partial luma pages', async () => {
    const repository = new IndexedDbPagedAssetRepository(new FakeIDBFactory(), FakeIDBKeyRange);
    const writePage = repository.writePage.bind(repository);
    repository.writePage = vi.fn(async (assetId, index, page) => {
      if (assetId === 'quota-luma') {
        throw new DOMException('fixture storage quota exhausted', 'QuotaExceededError');
      }
      await writePage(assetId, index, page);
    });
    const png = encodeRgbPng(new Uint8Array(8 * 8 * 3).fill(120), 8, 8);

    await expect(
      importPngToPagedAssets(
        new NodeBlob([png], { type: 'image/png' }) as Blob,
        {
          assetId: 'quota-source',
          lumaAssetId: 'quota-luma',
          sourceName: 'quota.png',
          createdAtEpochMs: 7,
          maxEdge: 8,
          maxPixels: 64,
          outputPageBytes: 8,
        },
        repository,
      ),
    ).rejects.toMatchObject({ name: 'QuotaExceededError' });

    await expect(repository.readManifest('quota-source')).resolves.toBeNull();
    await expect(repository.readManifest('quota-luma')).resolves.toBeNull();
    await expect(repository.readPage('quota-luma', 0)).resolves.toBeNull();
  });

  it('removes source and partial luma staging when decode is cancelled', async () => {
    const repository = new IndexedDbPagedAssetRepository(new FakeIDBFactory(), FakeIDBKeyRange);
    const controller = new AbortController();
    const png = encodeRgbPng(new Uint8Array(64 * 64 * 3).fill(120), 64, 64);

    await expect(
      importPngToPagedAssets(
        new NodeBlob([png], { type: 'image/png' }) as Blob,
        {
          assetId: 'cancel-source',
          lumaAssetId: 'cancel-luma',
          sourceName: 'cancel.png',
          createdAtEpochMs: 2,
          maxEdge: 64,
          maxPixels: 64 * 64,
          signal: controller.signal,
          onProgress: (progress) => {
            if (progress.phase === 'decoding') controller.abort();
          },
        },
        repository,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    await expect(repository.readManifest('cancel-source')).resolves.toBeNull();
    await expect(repository.readManifest('cancel-luma')).resolves.toBeNull();
  });

  it('removes source and luma staging when the platform requires legacy fallback', async () => {
    const repository = new IndexedDbPagedAssetRepository(new FakeIDBFactory(), FakeIDBKeyRange);
    const png = encodeRgbPng(Uint8Array.of(255, 0, 0), 1, 1);
    vi.stubGlobal('DecompressionStream', undefined);

    await expect(
      importPngToPagedAssets(
        new NodeBlob([png], { type: 'image/png' }) as Blob,
        {
          assetId: 'fallback-source',
          lumaAssetId: 'fallback-luma',
          sourceName: 'fallback.png',
          createdAtEpochMs: 3,
          maxEdge: 8,
          maxPixels: 64,
        },
        repository,
      ),
    ).resolves.toMatchObject({ kind: 'legacy-fallback' });

    await expect(repository.readManifest('fallback-source')).resolves.toBeNull();
    await expect(repository.readManifest('fallback-luma')).resolves.toBeNull();
  });
});
