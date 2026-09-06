import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { decodeRasterLuma } from '../../core/job/raster-luma-decode';
import { PngThumbnailBuilder } from '../import/png-thumbnail';
import { readRasterSourceFile } from '../import/paged-raster-source';
import {
  hydratePagedRasterImage,
  type PagedRasterAssetReader,
} from '../import/paged-raster-hydration';
import {
  collectPagedRasterAssetIds,
  PagedRasterAssetLifecycle,
  type PagedRasterOwnershipState,
} from '../import/paged-raster-asset-lifecycle';
import { rasterDisplayDataUrl } from '../workspace/draw-raster';
import { useStore } from './store';
import { resetStore } from './test-helpers';

// Complete valid PNGs: 48x24 white, 48x24 black, and 24x12 black. The bounded
// 2x1 thumbnail below is deliberately distinct from these full source grids.
const WHITE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAYCAYAAAC8/X7cAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAPklEQVRYhdXOQREAAAyDMPybZiL62BEFwTiMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwzi+A6sDu7rvAHf3FE8AAAAASUVORK5CYII=';
const BLACK_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAYCAYAAAC8/X7cAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASklEQVRYhe2TwQ0AMBCC2H9pOga51Id/IQrg8VAXcAD0Ft2E6E26E3Mz1AUcAL1FNyF6k+7E3Ax1AQdAb9FNiN6kOzE3Q13ArwEeAt97vdY59FUAAAAASUVORK5CYII=';
const SMALL_BLACK_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABgAAAAMCAYAAAB4MH11AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAIUlEQVQ4jWNgYGD4T2PMMGrB/9Eg+j+aiv6PZjQGPKUBAK2SHvAW0F2nAAAAAElFTkSuQmCC';
const sourceBytes = Uint8Array.from(atob(WHITE_PNG), (c) => c.charCodeAt(0));
const sourceLuma = new Uint8Array(48 * 24).fill(255);
const pngUrl = (base64: string) => `data:image/png;base64,${base64}`;
const blackFields = {
  dataUrl: pngUrl(BLACK_PNG),
  lumaBase64: btoa('\0'.repeat(48 * 24)),
  pixelWidth: 48,
  pixelHeight: 24,
};

function image(): RasterImage {
  const builder = new PngThumbnailBuilder(48, 24, 2);
  for (let row = 0; row < 24; row += 1) builder.accept(new Uint8Array(48).fill(255));
  const thumbnail = builder.finish();
  return {
    kind: 'raster-image',
    id: 'paged-image',
    source: 'source.png',
    pixelWidth: 48,
    pixelHeight: 24,
    bounds: { minX: 7, minY: 9, maxX: 19, maxY: 15 },
    transform: {
      ...IDENTITY_TRANSFORM,
      x: 33,
      y: 44,
      scaleX: 1.6,
      scaleY: 0.8,
      rotationDeg: 31,
      mirrorX: true,
    },
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 4,
    operationIds: ['image-op'],
    brightness: 8,
    contrast: 12,
    gamma: 1.1,
    imageMaskId: 'mask',
    traceSourceId: 'original-source',
    imageAsset: {
      schemaVersion: 1,
      repository: 'curvedesk-import-assets-v1',
      sourceAssetId: 'source-pages',
      lumaAssetId: 'luma-pages',
      sourceMimeType: 'image/png',
      sourceByteLength: sourceBytes.length,
      lumaByteLength: sourceLuma.length,
      naturalWidth: 48,
      naturalHeight: 24,
      sampledWidth: 48,
      sampledHeight: 24,
      thumbnail: {
        mimeType: 'image/bmp',
        width: thumbnail.width,
        height: thumbnail.height,
        dataUrl: `data:image/bmp;base64,${btoa(String.fromCharCode(...thumbnail.bytes))}`,
      },
    },
  };
}

function repository(reads: string[]): PagedRasterAssetReader {
  return {
    readManifest: async (assetId) => ({
      schemaVersion: 1,
      assetId,
      sourceName: 'luma',
      mimeType: 'application/x-curvedesk-luma',
      byteLength: sourceLuma.length,
      writtenByteLength: sourceLuma.length,
      pageBytes: sourceLuma.length,
      pageCount: 1,
      createdAtEpochMs: 0,
      state: 'ready',
    }),
    readAssetChunks: async function* (assetId) {
      reads.push(assetId);
      const bytes = assetId === 'source-pages' ? sourceBytes : sourceLuma;
      yield bytes.subarray(0, 37);
      yield bytes.subarray(37);
    },
  };
}

async function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(btoa(String.fromCharCode(...new Uint8Array(reader.result as ArrayBuffer))));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read PNG fixture'));
    reader.readAsArrayBuffer(file);
  });
}

function current(id = 'paged-image'): RasterImage {
  const object = useStore.getState().project.scene.objects.find((o) => o.id === id);
  if (object?.kind !== 'raster-image') throw new Error(`Missing raster ${id}`);
  return object;
}

function setup(source = image()): void {
  const project = createProject();
  useStore.getState().setProject({
    ...project,
    scene: {
      ...project.scene,
      objects: [source],
      layers: [
        {
          ...createLayer({ id: 'image-op', color: '#808080', mode: 'image' }),
          power: 31,
          speed: 1234,
        },
      ],
    },
  });
}

async function expectRevision(object: RasterImage, edited: boolean): Promise<void> {
  const repo = repository([]);
  expect(await fileBase64(await readRasterSourceFile(object, 'current.png', repo))).toBe(
    edited ? BLACK_PNG : WHITE_PNG,
  );
  expect(rasterDisplayDataUrl(object)).toBe(
    edited ? pngUrl(BLACK_PNG) : (object.imageAsset?.thumbnail.dataUrl ?? pngUrl(WHITE_PNG)),
  );
  expect([...decodeRasterLuma(await hydratePagedRasterImage(object, repo))]).toEqual(
    Array<number>(48 * 24).fill(edited ? 0 : 255),
  );
}

beforeEach(() => resetStore());

describe('Image Studio current revision after Apply', () => {
  it.each(['paged', 'embedded'] as const)(
    'publishes coherent full pixels, display and luma for %s sources',
    async (kind) => {
      const paged = image();
      const { imageAsset: _oldAsset, ...fields } = paged;
      setup(
        kind === 'paged'
          ? paged
          : { ...fields, dataUrl: pngUrl(WHITE_PNG), lumaBase64: btoa('\xff'.repeat(48 * 24)) },
      );
      const before = useStore.getState().project,
        source = current();
      useStore.getState().applyEditedImage(source.id, blackFields);
      const edited = current();
      await expectRevision(edited, true);
      expect(edited).not.toHaveProperty('imageAsset');
      expect(edited).toMatchObject({
        id: source.id,
        source: source.source,
        pixelWidth: 48,
        pixelHeight: 24,
        bounds: source.bounds,
        transform: source.transform,
        operationIds: source.operationIds,
        brightness: source.brightness,
        contrast: source.contrast,
        gamma: source.gamma,
        imageMaskId: source.imageMaskId,
        traceSourceId: source.traceSourceId,
      });
      expect(useStore.getState().project.scene.layers).toBe(before.scene.layers);
      expect(useStore.getState().undoStack).toHaveLength(1);
      useStore.getState().undo();
      expect(useStore.getState().project).toBe(before);
      await expectRevision(current(), false);
      useStore.getState().redo();
      expect(current()).toBe(edited);
      await expectRevision(current(), true);
    },
  );

  it('isolates an actual clipboard copy sharing old pages and groups Apply undo/redo', async () => {
    setup();
    useStore.getState().selectObject('paged-image');
    useStore.getState().copySelection();
    useStore.getState().pasteClipboard();
    const copyId = useStore.getState().selectedObjectId;
    if (copyId === null) throw new Error('Pasted raster was not selected');
    const copy = current(copyId),
      source = current();
    expect(copy.imageAsset?.sourceAssetId).toBe(source.imageAsset?.sourceAssetId);
    const before = useStore.getState().project,
      undoDepth = useStore.getState().undoStack.length;
    useStore.getState().applyEditedImage(source.id, blackFields);
    const committed = useStore.getState().project;
    await expectRevision(current(), true);
    await expectRevision(current(copyId), false);
    expect(current(copyId)).toBe(copy);
    expect(useStore.getState().undoStack).toHaveLength(undoDepth + 1);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    await expectRevision(current(), false);
    await expectRevision(current(copyId), false);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(committed);
    await expectRevision(current(), true);
    await expectRevision(current(copyId), false);
    expect(source.imageAsset?.sourceByteLength).toBe(sourceBytes.length);
  });

  it('retains old source and luma through each history/clipboard owner without deleting pages', async () => {
    setup();
    const before = useStore.getState().project;
    useStore.getState().applyEditedImage('paged-image', blackFields);
    const after = useStore.getState().project;
    const empty: PagedRasterOwnershipState = {
      project: after,
      undoStack: [],
      redoStack: [],
      pendingUndo: null,
      sceneClipboard: null,
    };
    const owners: PagedRasterOwnershipState[] = [
      { ...empty, project: before },
      { ...empty, undoStack: [before] },
      { ...empty, redoStack: [before] },
      { ...empty, pendingUndo: before },
      { ...empty, sceneClipboard: { objects: before.scene.objects } },
    ];
    const repo = { cancelDelete: vi.fn(async () => undefined), requestDelete: vi.fn() };
    const lifecycle = new PagedRasterAssetLifecycle(repo);
    for (const owner of owners) {
      expect([...collectPagedRasterAssetIds(owner)].sort()).toEqual(['luma-pages', 'source-pages']);
      await lifecycle.transition(empty, owner);
      await lifecycle.transition(owner, empty);
    }
    expect(repo.requestDelete).not.toHaveBeenCalled();
    await expectRevision(before.scene.objects[0] as RasterImage, false);
  });

  it.each(['resize', 'crop'] as const)(
    'uses the applied %s grid and bounds instead of stale asset dimensions',
    async (kind) => {
      setup();
      const before = useStore.getState().project,
        source = current();
      const bounds = { minX: 10, minY: 10.5, maxX: 16, maxY: 13.5 };
      useStore.getState().applyEditedImage(source.id, {
        dataUrl: pngUrl(SMALL_BLACK_PNG),
        lumaBase64: btoa('\0'.repeat(24 * 12)),
        pixelWidth: 24,
        pixelHeight: 12,
        ...(kind === 'crop' ? { bounds } : {}),
      });
      const edited = current();
      expect(
        await fileBase64(await readRasterSourceFile(edited, 'resized.png', repository([]))),
      ).toBe(SMALL_BLACK_PNG);
      expect([...decodeRasterLuma(await hydratePagedRasterImage(edited, repository([])))]).toEqual(
        Array<number>(24 * 12).fill(0),
      );
      expect(edited).toMatchObject({
        pixelWidth: 24,
        pixelHeight: 12,
        bounds: kind === 'crop' ? bounds : source.bounds,
        transform: source.transform,
        operationIds: source.operationIds,
      });
      expect(rasterDisplayDataUrl(edited)).toBe(pngUrl(SMALL_BLACK_PNG));
      useStore.getState().undo();
      expect(useStore.getState().project).toBe(before);
      await expectRevision(current(), false);
      useStore.getState().redo();
      expect(current()).toBe(edited);
    },
  );
});
