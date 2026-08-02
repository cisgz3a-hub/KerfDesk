import { IDBFactory as FakeIDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { IndexedDbPagedAssetRepository } from './paged-asset-indexeddb';
import { IndexedDbPagedAssetLeaseRepository } from './paged-asset-indexeddb-leases';
import { IndexedDbPagedAssetReconciliationRepository } from './paged-asset-startup-reconciliation-repository';
import { stageAssetPages } from './paged-asset-stager';

describe('IndexedDbPagedAssetRepository', () => {
  it('publishes a ready manifest only after every page is durable', async () => {
    const repository = new IndexedDbPagedAssetRepository(new FakeIDBFactory(), FakeIDBKeyRange);
    const source = new NodeBlob(['abcd', 'efghij'], { type: 'image/png' }) as Blob;

    const manifest = await stageAssetPages(
      source,
      {
        assetId: 'asset-ready',
        sourceName: 'fixture.png',
        createdAtEpochMs: 10,
        pageBytes: 4,
      },
      repository,
    );

    await expect(repository.readManifest('asset-ready')).resolves.toEqual(manifest);
    await expect(repository.readPage('asset-ready', 0)).resolves.toMatchObject({ size: 4 });
    await expect(repository.readPage('asset-ready', 1)).resolves.toMatchObject({ size: 4 });
    await expect(repository.readPage('asset-ready', 2)).resolves.toMatchObject({ size: 2 });
    const chunks: Uint8Array[] = [];
    for await (const chunk of repository.readAssetChunks('asset-ready')) chunks.push(chunk);
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([4, 4, 2]);
    expect(new TextDecoder().decode(concatBytes(chunks))).toBe('abcdefghij');
  });

  it('removes a staging manifest and its pages on abort', async () => {
    const repository = new IndexedDbPagedAssetRepository(new FakeIDBFactory(), FakeIDBKeyRange);
    const controller = new AbortController();
    const sink = {
      begin: repository.begin.bind(repository),
      writePage: async (assetId: string, index: number, page: Blob) => {
        await repository.writePage(assetId, index, page);
        controller.abort();
      },
      commit: repository.commit.bind(repository),
      abort: repository.abort.bind(repository),
    };

    await expect(
      stageAssetPages(
        new NodeBlob(['cancel me']) as Blob,
        {
          assetId: 'asset-cancelled',
          sourceName: 'cancelled.png',
          createdAtEpochMs: 20,
          pageBytes: 4,
          signal: controller.signal,
        },
        sink,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    await expect(repository.readManifest('asset-cancelled')).resolves.toBeNull();
    await expect(repository.readPage('asset-cancelled', 0)).resolves.toBeNull();
  });

  it('does not overwrite a ready asset when an id is reused', async () => {
    const repository = new IndexedDbPagedAssetRepository(new FakeIDBFactory(), FakeIDBKeyRange);
    await stageAssetPages(
      new NodeBlob(['original']) as Blob,
      {
        assetId: 'asset-collision',
        sourceName: 'original.bin',
        createdAtEpochMs: 1,
        pageBytes: 8,
      },
      repository,
    );

    await expect(
      stageAssetPages(
        new NodeBlob(['replacement']) as Blob,
        {
          assetId: 'asset-collision',
          sourceName: 'replacement.bin',
          createdAtEpochMs: 2,
          pageBytes: 11,
        },
        repository,
      ),
    ).rejects.toBeDefined();

    await expect(repository.readManifest('asset-collision')).resolves.toMatchObject({
      sourceName: 'original.bin',
      byteLength: 8,
      state: 'ready',
    });
    const retained = await repository.readPage('asset-collision', 0);
    await expect(retained?.text()).resolves.toBe('original');
  });

  it('rejects a page whose index or byte length does not match the staging manifest', async () => {
    const repository = new IndexedDbPagedAssetRepository(new FakeIDBFactory(), FakeIDBKeyRange);
    await repository.begin({
      schemaVersion: 1,
      assetId: 'asset-invalid-page',
      sourceName: 'invalid.bin',
      mimeType: '',
      byteLength: 5,
      writtenByteLength: 0,
      pageBytes: 4,
      pageCount: 2,
      createdAtEpochMs: 1,
      state: 'staging',
    });

    await expect(
      repository.writePage('asset-invalid-page', 0, new NodeBlob(['bad']) as Blob),
    ).rejects.toThrow(/bytes/);
    await expect(repository.readManifest('asset-invalid-page')).resolves.toMatchObject({
      writtenByteLength: 0,
      state: 'staging',
    });
    await expect(repository.readPage('asset-invalid-page', 0)).resolves.toBeNull();
  });

  it('defers final deletion across repository instances until every durable read lease releases', async () => {
    const factory = new FakeIDBFactory();
    const owner = new IndexedDbPagedAssetRepository(factory, FakeIDBKeyRange);
    const reader = new IndexedDbPagedAssetLeaseRepository(factory, FakeIDBKeyRange);
    const lifecycle = new IndexedDbPagedAssetLeaseRepository(factory, FakeIDBKeyRange);
    await stageAssetPages(
      new NodeBlob(['leased']) as Blob,
      {
        assetId: 'asset-leased',
        sourceName: 'leased.bin',
        createdAtEpochMs: 1,
        pageBytes: 6,
      },
      owner,
    );

    await reader.acquireReadLease(['asset-leased'], 'reader-a');
    await reader.acquireReadLease(['asset-leased'], 'reader-b');
    await expect(lifecycle.requestDelete('asset-leased')).resolves.toBe('deferred');
    await expect(owner.readManifest('asset-leased')).resolves.toMatchObject({ state: 'ready' });

    await reader.releaseReadLease(['asset-leased'], 'reader-a');
    await expect(owner.readManifest('asset-leased')).resolves.toMatchObject({ state: 'ready' });
    await reader.releaseReadLease(['asset-leased'], 'reader-b');
    await expect(owner.readManifest('asset-leased')).resolves.toBeNull();
    await expect(owner.readPage('asset-leased', 0)).resolves.toBeNull();
  });

  it('cancels a deferred deletion when scene ownership returns', async () => {
    const factory = new FakeIDBFactory();
    const owner = new IndexedDbPagedAssetRepository(factory, FakeIDBKeyRange);
    const leases = new IndexedDbPagedAssetLeaseRepository(factory, FakeIDBKeyRange);
    await stageAssetPages(
      new NodeBlob(['retained']) as Blob,
      {
        assetId: 'asset-retained',
        sourceName: 'retained.bin',
        createdAtEpochMs: 1,
        pageBytes: 8,
      },
      owner,
    );
    await leases.acquireReadLease(['asset-retained'], 'reader');
    await expect(leases.requestDelete('asset-retained')).resolves.toBe('deferred');

    await leases.cancelDelete('asset-retained');
    await leases.releaseReadLease(['asset-retained'], 'reader');

    await expect(owner.readManifest('asset-retained')).resolves.toMatchObject({ state: 'ready' });
  });

  it('retains read fidelity when browser lock acquisition is unavailable', async () => {
    const factory = new FakeIDBFactory();
    const owner = new IndexedDbPagedAssetRepository(factory, FakeIDBKeyRange);
    const locks = {
      hold: vi.fn(async () => {
        throw new DOMException('lock unavailable', 'SecurityError');
      }),
    };
    const leases = new IndexedDbPagedAssetLeaseRepository(factory, FakeIDBKeyRange, locks);
    await stageAssetPages(
      new NodeBlob(['readable']) as Blob,
      {
        assetId: 'asset-without-lock',
        sourceName: 'readable.bin',
        createdAtEpochMs: 1,
        pageBytes: 8,
      },
      owner,
    );

    await expect(
      leases.acquireReadLease(['asset-without-lock'], 'reader-without-lock'),
    ).resolves.toBeUndefined();
    const reconciliation = new IndexedDbPagedAssetReconciliationRepository(
      factory,
      FakeIDBKeyRange,
    );
    await expect(reconciliation.listExpiredLeases(Number.MAX_SAFE_INTEGER, 64)).resolves.toEqual(
      [],
    );
    await leases.releaseReadLease(['asset-without-lock'], 'reader-without-lock');
    await expect(owner.readManifest('asset-without-lock')).resolves.toMatchObject({
      state: 'ready',
    });
  });
});

function concatBytes(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
