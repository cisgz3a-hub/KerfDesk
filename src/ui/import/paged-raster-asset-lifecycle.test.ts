import { describe, expect, it, vi } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import {
  PagedRasterAssetLifecycle,
  collectPagedRasterAssetIds,
  type PagedRasterOwnershipState,
} from './paged-raster-asset-lifecycle';

const ASSET = {
  schemaVersion: 1,
  repository: 'curvedesk-import-assets-v1',
  sourceAssetId: 'source-pages',
  lumaAssetId: 'luma-pages',
  sourceMimeType: 'image/png',
  sourceByteLength: 10,
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
} as const;

describe('PagedRasterAssetLifecycle', () => {
  it('does not visit project/history objects on unrelated store updates', async () => {
    const readObjects = vi.fn(() => [pagedRaster('untouched')]);
    const objects = new Proxy([pagedRaster('untouched')], {
      get(target, key, receiver) {
        if (key === Symbol.iterator) readObjects();
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const project = createProject();
    const owned = state({ ...project, scene: { ...project.scene, objects } });
    const lifecycle = new PagedRasterAssetLifecycle({ cancelDelete: vi.fn(async () => undefined) });

    await lifecycle.transition(owned, { ...owned });
    expect(readObjects).not.toHaveBeenCalled();
  });

  it('caches immutable object lists shared by history without exposing mutable cached sets', () => {
    const raster = pagedRaster('shared-history');
    const readAsset = vi.fn(() => ASSET);
    Object.defineProperty(raster, 'imageAsset', { get: readAsset });
    const project = projectWith(raster);
    const owned = state(project, {
      undoStack: Array.from({ length: 100 }, () => ({ ...project })),
    });

    const first = collectPagedRasterAssetIds(owned);
    const firstReadCount = readAsset.mock.calls.length;
    first.clear();
    expect([...collectPagedRasterAssetIds({ ...owned })].sort()).toEqual([
      'luma-pages',
      'source-pages',
    ]);
    expect(readAsset).toHaveBeenCalledTimes(firstReadCount);
    expect(firstReadCount).toBeGreaterThan(0);
    expect(firstReadCount).toBeLessThan(4);
  });

  it('coalesces bursts and still retains assets added while a repair is in flight', async () => {
    let release: (() => void) | undefined;
    const firstRepair = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repository = {
      cancelDelete: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    };
    repository.cancelDelete.mockImplementationOnce(() => firstRepair);
    const lifecycle = new PagedRasterAssetLifecycle(repository);
    const empty = state(createProject());
    const owned = state(projectWith(pagedRaster('first')));
    const firstDrain = lifecycle.transition(empty, owned);
    await Promise.resolve();
    const second = {
      ...pagedRaster('second'),
      imageAsset: { ...ASSET, sourceAssetId: 'source-2', lumaAssetId: 'luma-2' },
    };
    const updated = state(projectWith(pagedRaster('first'), second));
    expect(lifecycle.transition(owned, updated)).toBe(firstDrain);
    for (let index = 0; index < 100; index += 1) {
      expect(lifecycle.transition(updated, { ...updated })).toBe(firstDrain);
    }
    release?.();
    await firstDrain;
    expect(repository.cancelDelete.mock.calls).toEqual([
      ['source-pages'],
      ['luma-pages'],
      ['source-2'],
      ['luma-2'],
    ]);
  });

  it('re-reads a replaced object array while undo retains the former page assets', async () => {
    const raster = pagedRaster('replacement');
    const previousProject = projectWith(raster);
    const previous = state(previousProject);
    collectPagedRasterAssetIds(previous);
    const current = state(
      projectWith({
        ...raster,
        imageAsset: {
          ...ASSET,
          sourceAssetId: 'replacement-source',
          lumaAssetId: 'replacement-luma',
        },
      }),
      { undoStack: [previousProject] },
    );
    const repository = { cancelDelete: vi.fn(async () => undefined) };
    const lifecycle = new PagedRasterAssetLifecycle(repository);
    await lifecycle.transition(previous, current);
    expect([...collectPagedRasterAssetIds(current)].sort()).toEqual([
      'luma-pages',
      'replacement-luma',
      'replacement-source',
      'source-pages',
    ]);
    expect(repository.cancelDelete.mock.calls).toEqual([
      ['replacement-source'],
      ['replacement-luma'],
    ]);
  });

  it('does not classify ready assets as orphaned from live-state absence alone', async () => {
    const repository = {
      cancelDelete: vi.fn(async () => undefined),
      requestDelete: vi.fn(async () => 'deleted' as const),
    };
    const lifecycle = new PagedRasterAssetLifecycle(repository);
    const owned = state(projectWith(pagedRaster('saved-project-reference')));

    await lifecycle.transition(owned, state(createProject()));

    expect(repository.requestDelete).not.toHaveBeenCalled();
  });

  it('retains ready pages after the final in-session owner leaves', async () => {
    const repository = {
      cancelDelete: vi.fn(async () => undefined),
      requestDelete: vi.fn(async () => 'deleted' as const),
    };
    const lifecycle = new PagedRasterAssetLifecycle(repository);
    const first = pagedRaster('first');
    const second = pagedRaster('second');
    const both = state(projectWith(first, second));
    const one = state(projectWith(second));

    await lifecycle.transition(both, one);
    expect(repository.requestDelete).not.toHaveBeenCalled();

    const deletedButUndoable = state(createProject(), {
      undoStack: [projectWith(second)],
      pendingUndo: projectWith(second),
      clipboardObjects: [second],
    });
    await lifecycle.transition(one, deletedButUndoable);
    expect(repository.requestDelete).not.toHaveBeenCalled();

    await lifecycle.transition(deletedButUndoable, state(createProject()));
    expect(repository.requestDelete).not.toHaveBeenCalled();
  });

  it('retains failed deferred-deletion cancellation so a later transition can retry it', async () => {
    const repository = {
      cancelDelete: vi
        .fn<(assetId: string) => Promise<void>>()
        .mockRejectedValueOnce(new Error('storage busy'))
        .mockResolvedValue(undefined),
      requestDelete: vi.fn(async () => 'deleted' as const),
    };
    const failures: string[][] = [];
    const lifecycle = new PagedRasterAssetLifecycle(repository, (assetIds) => {
      failures.push([...assetIds]);
    });
    const empty = state(createProject());
    const owned = state(projectWith(pagedRaster('retry')));

    await lifecycle.transition(empty, owned);
    expect(failures).toEqual([['source-pages']]);

    await lifecycle.transition(owned, owned);
    expect(repository.cancelDelete).toHaveBeenCalledWith('source-pages');
    expect(repository.cancelDelete).toHaveBeenCalledWith('luma-pages');
    expect(repository.requestDelete).not.toHaveBeenCalled();
  });

  it('collects each source/luma pair once across shared project and clipboard owners', () => {
    const raster = pagedRaster('shared');
    const ownership = state(projectWith(raster, pagedRaster('clone')), {
      undoStack: [projectWith(raster)],
      clipboardObjects: [raster],
    });

    expect([...collectPagedRasterAssetIds(ownership)].sort()).toEqual([
      'luma-pages',
      'source-pages',
    ]);
  });

  it('cancels a durable deferred deletion when an asset becomes owned again', async () => {
    const repository = {
      cancelDelete: vi.fn(async () => undefined),
      requestDelete: vi.fn(async () => 'deferred' as const),
    };
    const lifecycle = new PagedRasterAssetLifecycle(repository);
    const owned = state(projectWith(pagedRaster('owned')));
    const empty = state(createProject());

    await lifecycle.transition(owned, empty);
    await lifecycle.transition(empty, owned);
    await lifecycle.transition(owned, owned);

    expect(repository.cancelDelete.mock.calls).toEqual([['source-pages'], ['luma-pages']]);
  });
});

function pagedRaster(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    imageAsset: ASSET,
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 10,
  };
}

function projectWith(...objects: RasterImage[]): Project {
  const project = createProject();
  return { ...project, scene: { ...project.scene, objects } };
}

function state(
  project: Project,
  options: {
    readonly undoStack?: ReadonlyArray<Project>;
    readonly pendingUndo?: Project | null;
    readonly clipboardObjects?: ReadonlyArray<RasterImage>;
  } = {},
): PagedRasterOwnershipState {
  return {
    project,
    undoStack: options.undoStack ?? [],
    redoStack: [],
    pendingUndo:
      options.pendingUndo === undefined || options.pendingUndo === null
        ? null
        : {
            project: options.pendingUndo,
            undoStack: [],
            redoStack: [],
            dirty: false,
            selectedObjectId: null,
            additionalSelectedIds: new Set(),
            selectedPathNode: null,
            selectedPathNodes: [],
          },
    sceneClipboard:
      options.clipboardObjects === undefined ? null : { objects: options.clipboardObjects },
  };
}
