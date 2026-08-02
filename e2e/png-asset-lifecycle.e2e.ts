import { expect, test } from '@playwright/test';

test('qualified PNG pages remain durable after final in-session ownership release', async ({
  page,
}) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    interface Manifest {
      readonly schemaVersion: 1;
      readonly assetId: string;
      readonly sourceName: string;
      readonly mimeType: string;
      readonly byteLength: number;
      readonly writtenByteLength: number;
      readonly pageBytes: number;
      readonly pageCount: number;
      readonly createdAtEpochMs: number;
      readonly state: 'staging' | 'ready';
    }
    interface Repository {
      begin(manifest: Manifest): Promise<void>;
      writePage(assetId: string, index: number, page: Blob): Promise<void>;
      commit(manifest: Manifest): Promise<void>;
      readManifest(assetId: string): Promise<Manifest | null>;
      acquireReadLease(assetIds: readonly string[], leaseId: string): Promise<void>;
      releaseReadLease(assetIds: readonly string[], leaseId: string): Promise<void>;
    }
    interface RepositoryApi {
      IndexedDbPagedAssetRepository: new () => Repository;
    }
    interface StoreState {
      readonly project: {
        readonly scene: {
          readonly objects: readonly unknown[];
        };
      };
      removeSceneObject(id: string): void;
    }
    interface StoreApi {
      useStore: {
        getState(): StoreState;
        setState(partial: Record<string, unknown>): void;
      };
    }

    const repositoryPath = '/src/ui/import/paged-asset-indexeddb.ts';
    const storePath = '/src/ui/state/store.ts';
    const repositories = (await import(
      /* @vite-ignore */ repositoryPath
    )) as Partial<RepositoryApi>;
    const store = (await import(/* @vite-ignore */ storePath)) as Partial<StoreApi>;
    if (repositories.IndexedDbPagedAssetRepository === undefined || store.useStore === undefined) {
      throw new Error('PNG lifecycle production modules are unavailable');
    }

    const repository = new repositories.IndexedDbPagedAssetRepository();
    const prefix = crypto.randomUUID();
    const sourceAssetId = `${prefix}-source`;
    const lumaAssetId = `${prefix}-luma`;
    await persistOnePage(repository, sourceAssetId, new Blob(['png'], { type: 'image/png' }));
    await persistOnePage(
      repository,
      lumaAssetId,
      new Blob([Uint8Array.of(128)], { type: 'application/x-curvedesk-luma' }),
    );

    const imageAsset = {
      schemaVersion: 1,
      repository: 'curvedesk-import-assets-v1',
      sourceAssetId,
      lumaAssetId,
      sourceMimeType: 'image/png',
      sourceByteLength: 3,
      lumaByteLength: 1,
      naturalWidth: 1,
      naturalHeight: 1,
      sampledWidth: 1,
      sampledHeight: 1,
      thumbnail: {
        mimeType: 'image/bmp',
        dataUrl: 'data:image/bmp;base64,Qk0=',
        width: 1,
        height: 1,
      },
    };
    const raster = (id: string) => ({
      kind: 'raster-image',
      id,
      source: `${id}.png`,
      imageAsset,
      pixelWidth: 1,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      color: '#808080',
      dither: 'grayscale',
      linesPerMm: 10,
    });
    const current = store.useStore.getState().project;
    store.useStore.setState({
      project: {
        ...current,
        scene: { ...current.scene, objects: [raster('shared-a'), raster('shared-b')] },
      },
      undoStack: [],
      redoStack: [],
      pendingUndo: null,
      sceneClipboard: null,
    });

    store.useStore.getState().removeSceneObject('shared-a');
    await Promise.resolve();
    const afterSharedDelete = await repository.readManifest(sourceAssetId);
    store.useStore.getState().removeSceneObject('shared-b');
    await Promise.resolve();
    const whileUndoOwns = await repository.readManifest(sourceAssetId);

    const leaseId = crypto.randomUUID();
    await repository.acquireReadLease([lumaAssetId], leaseId);
    store.useStore.setState({
      undoStack: [],
      redoStack: [],
      pendingUndo: null,
      sceneClipboard: null,
    });
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    const whileReadLeaseOwns = await repository.readManifest(lumaAssetId);
    await repository.releaseReadLease([lumaAssetId], leaseId);
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    return {
      afterSharedDelete: afterSharedDelete?.state ?? null,
      whileUndoOwns: whileUndoOwns?.state ?? null,
      whileReadLeaseOwns: whileReadLeaseOwns?.state ?? null,
      afterFinalSourceRelease: (await repository.readManifest(sourceAssetId))?.state ?? null,
      afterFinalLumaRelease: (await repository.readManifest(lumaAssetId))?.state ?? null,
    };

    async function persistOnePage(target: Repository, assetId: string, blob: Blob): Promise<void> {
      const staging: Manifest = {
        schemaVersion: 1,
        assetId,
        sourceName: assetId,
        mimeType: blob.type,
        byteLength: blob.size,
        writtenByteLength: 0,
        pageBytes: blob.size,
        pageCount: 1,
        createdAtEpochMs: Date.now(),
        state: 'staging',
      };
      await target.begin(staging);
      await target.writePage(assetId, 0, blob);
      await target.commit({ ...staging, writtenByteLength: blob.size, state: 'ready' });
    }
  });

  expect(result).toEqual({
    afterSharedDelete: 'ready',
    whileUndoOwns: 'ready',
    whileReadLeaseOwns: 'ready',
    afterFinalSourceRelease: 'ready',
    afterFinalLumaRelease: 'ready',
  });
});

test('forced real PNG worker retirement cleans partial staged pages', async ({ page }) => {
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');

  const result = await page.evaluate(async () => {
    interface Progress {
      readonly phase: string;
    }
    interface ClientApi {
      importPngOffThread(
        blob: Blob,
        options: {
          readonly assetId: string;
          readonly lumaAssetId: string;
          readonly sourceName: string;
          readonly createdAtEpochMs: number;
          readonly maxEdge: number;
          readonly maxPixels: number;
          onProgress(progress: Progress): void;
        },
      ): Promise<unknown> | null;
      resetPngImportWorkerForTests(): Promise<void>;
    }
    interface Repository {
      readManifest(assetId: string): Promise<{ readonly state: string } | null>;
    }
    interface RepositoryApi {
      IndexedDbPagedAssetRepository: new () => Repository;
    }

    const clientPath = '/src/ui/import/png-import-worker-client.ts';
    const repositoryPath = '/src/ui/import/paged-asset-indexeddb.ts';
    const client = (await import(/* @vite-ignore */ clientPath)) as Partial<ClientApi>;
    const repositories = (await import(
      /* @vite-ignore */ repositoryPath
    )) as Partial<RepositoryApi>;
    if (
      typeof client.importPngOffThread !== 'function' ||
      typeof client.resetPngImportWorkerForTests !== 'function' ||
      repositories.IndexedDbPagedAssetRepository === undefined
    ) {
      throw new Error('PNG worker lifecycle production modules are unavailable');
    }

    const prefix = crypto.randomUUID();
    const sourceAssetId = `${prefix}-source`;
    const lumaAssetId = `${prefix}-luma`;
    let staged!: () => void;
    const firstPage = new Promise<void>((resolve) => {
      staged = resolve;
    });
    const pending = client.importPngOffThread(new Blob([new Uint8Array(32 * 1024 * 1024)]), {
      assetId: sourceAssetId,
      lumaAssetId,
      sourceName: 'abrupt.png',
      createdAtEpochMs: Date.now(),
      maxEdge: 8192,
      maxPixels: 32_000_000,
      onProgress: (progress) => {
        if (progress.phase === 'persisting-source') staged();
      },
    });
    if (pending === null) throw new Error('PNG worker request unavailable');
    const outcome = pending.then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    await firstPage;
    await client.resetPngImportWorkerForTests();
    const repository = new repositories.IndexedDbPagedAssetRepository();
    return {
      outcome: await outcome,
      source: await repository.readManifest(sourceAssetId),
      luma: await repository.readManifest(lumaAssetId),
    };
  });

  expect(result.outcome).toContain('PNG import worker reset');
  expect(result.source).toBeNull();
  expect(result.luma).toBeNull();
  expect(workerUrls.some((url) => url.includes('png-import-worker'))).toBe(true);
});
