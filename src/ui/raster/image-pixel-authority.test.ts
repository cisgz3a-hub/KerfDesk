import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { deserializeProject, serializeProject } from '../../io/project';
import { collectPagedRasterAssetIds } from '../import/paged-raster-asset-lifecycle';
import { hydratePagedRasterImage } from '../import/paged-raster-hydration';
import { readRasterSourceFile } from '../import/paged-raster-source';
import type { PagedAssetManifest } from '../import/paged-asset-stager';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { readFileAsDataUrl } from '../trace/image-loader';
import { cropMaskedRasterImage } from './crop-image';
import { lumaToBase64 } from './luma-bitmap';
import { buildProcessedRasterBitmap } from './processed-bitmap';

const SOURCE_LUMA = Uint8Array.of(10, 20, 30, 40, 50, 60, 70, 80);
const ASSET: NonNullable<RasterImage['imageAsset']> = {
  schemaVersion: 1,
  repository: 'curvedesk-import-assets-v1',
  sourceAssetId: 'original-source',
  lumaAssetId: 'original-luma',
  sourceMimeType: 'image/png',
  sourceByteLength: 30_000_000,
  lumaByteLength: 8,
  naturalWidth: 4,
  naturalHeight: 2,
  sampledWidth: 4,
  sampledHeight: 2,
  thumbnail: { mimeType: 'image/bmp', dataUrl: 'data:image/bmp;base64,b2xk', width: 4, height: 2 },
};
const EDITED_URL = 'data:image/png;base64,ZWRpdGVk';

function image(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'image',
    source: 'large.png',
    imageAsset: ASSET,
    pixelWidth: 4,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
  };
}

function projectWith(raster: RasterImage): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      objects: [raster],
      layers: [
        {
          ...createLayer({ id: 'layer', color: raster.color, mode: 'image' }),
          ditherAlgorithm: 'threshold',
          linesPerMm: 1,
          fillOverscanMm: 0,
        },
      ],
    },
  };
}

function repository(bytes = SOURCE_LUMA) {
  const manifest: PagedAssetManifest = {
    schemaVersion: 1,
    assetId: ASSET.lumaAssetId,
    sourceName: 'large.png.luma',
    mimeType: 'application/x-curvedesk-luma',
    byteLength: 8,
    writtenByteLength: 8,
    pageBytes: 3,
    pageCount: 3,
    createdAtEpochMs: 1,
    state: 'ready',
  };
  return {
    readManifest: vi.fn(async () => manifest),
    readAssetChunks: vi.fn(async function* () {
      for (let i = 0; i < bytes.length; i += 3) yield bytes.slice(i, i + 3);
    }),
    acquireReadLease: vi.fn(async () => undefined),
    releaseReadLease: vi.fn(async () => undefined),
  };
}

function currentImage(): RasterImage {
  const found = useStore.getState().project.scene.objects[0];
  if (found?.kind !== 'raster-image') throw new Error('missing image');
  return found;
}

function roundTrip(project: Project): Project {
  const result = deserializeProject(serializeProject(project));
  if (result.kind !== 'ok') throw new Error(`Round trip failed: ${JSON.stringify(result)}`);
  return result.project;
}

beforeEach(resetStore);

describe('authoritative pixels after editing a paged image', () => {
  it.each([
    { width: 4, height: 2 },
    { width: 2, height: 1 },
  ])(
    'Apply replaces the paged source at $width × $height through output, save/reopen and undo/redo',
    async ({ width, height }) => {
      const original = image();
      useStore.getState().setProject(projectWith(original));
      const luma = Uint8Array.from({ length: width * height }, (_, i) => (i % 2 === 0 ? 0 : 255));
      useStore.getState().applyEditedImage(original.id, {
        dataUrl: EDITED_URL,
        lumaBase64: lumaToBase64(luma),
        pixelWidth: width,
        pixelHeight: height,
      });
      const edited = currentImage();
      expect(edited).not.toHaveProperty('imageAsset');
      expect(edited).toMatchObject({
        pixelWidth: width,
        pixelHeight: height,
        bounds: original.bounds,
      });
      const pages = repository();
      expect(await hydratePagedRasterImage(edited, pages)).toBe(edited);
      const reopened = roundTrip(useStore.getState().project);
      const reopenedImage = reopened.scene.objects[0];
      if (reopenedImage?.kind !== 'raster-image') throw new Error('missing reopened image');
      expect(reopenedImage).toMatchObject({
        dataUrl: EDITED_URL,
        lumaBase64: lumaToBase64(luma),
        pixelWidth: width,
        pixelHeight: height,
      });
      expect(reopenedImage).not.toHaveProperty('imageAsset');
      const source = await readRasterSourceFile(reopenedImage, 'reopen.png', pages);
      expect(await readFileAsDataUrl(source)).toBe(EDITED_URL);
      expect(pages.readAssetChunks).not.toHaveBeenCalled();
      expect(pages.readManifest).not.toHaveBeenCalled();

      const layer = reopened.scene.layers[0];
      if (layer === undefined) throw new Error('missing layer');
      const expected: RasterImage = {
        kind: 'raster-image',
        id: 'image',
        source: 'large.png',
        dataUrl: EDITED_URL,
        lumaBase64: lumaToBase64(luma),
        pixelWidth: width,
        pixelHeight: height,
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
        transform: IDENTITY_TRANSFORM,
        color: '#808080',
        dither: 'threshold',
        linesPerMm: 1,
      };
      expect(buildProcessedRasterBitmap(reopenedImage, layer, reopened.device)).toEqual(
        buildProcessedRasterBitmap(expected, layer, reopened.device),
      );
      const prepared = prepareOutput(reopened);
      const expectedOutput = prepareOutput(projectWith(expected));
      expect(prepared.ok).toBe(true);
      expect(expectedOutput.ok).toBe(true);
      expect(emitPreparedGcode(prepared).gcode).toBe(emitPreparedGcode(expectedOutput).gcode);
      expect(emitPreparedGcode(prepared).gcode).toContain('S300');

      expect(collectPagedRasterAssetIds(useStore.getState())).toEqual(
        new Set([ASSET.sourceAssetId, ASSET.lumaAssetId]),
      );
      useStore.getState().undo();
      expect(currentImage()).toBe(original);
      expect((await hydratePagedRasterImage(currentImage(), pages)).lumaBase64).toBe(
        lumaToBase64(SOURCE_LUMA),
      );
      useStore.getState().redo();
      expect(currentImage()).toBe(edited);
      expect(collectPagedRasterAssetIds(useStore.getState())).toEqual(
        new Set([ASSET.sourceAssetId, ASSET.lumaAssetId]),
      );
    },
  );

  it('Crop reads complete leased luma pages and preserves crop pixels and undo source references', async () => {
    const original = { ...image(), imageMaskId: 'mask' };
    const mask = createRectangle({
      id: 'mask',
      color: '#000000',
      spec: { widthMm: 2, heightMm: 2, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 1 },
    });
    const pages = repository();
    const encoded = vi.fn(({ luma }: { luma: Uint8Array }) => ({
      dataUrl: EDITED_URL,
      lumaBase64: lumaToBase64(luma),
    }));
    const cropped = await cropMaskedRasterImage(original, mask, encoded, pages);
    expect(encoded).toHaveBeenCalledWith({
      width: 2,
      height: 2,
      luma: Uint8Array.of(20, 30, 60, 70),
    });
    expect(cropped).not.toHaveProperty('imageAsset');
    expect(cropped).not.toHaveProperty('imageMaskId');
    expect(cropped).toMatchObject({
      pixelWidth: 2,
      pixelHeight: 2,
      bounds: { minX: 1, minY: 0, maxX: 3, maxY: 2 },
    });
    expect(pages.acquireReadLease).toHaveBeenCalledOnce();
    expect(pages.releaseReadLease).toHaveBeenCalledWith(
      ...(pages.acquireReadLease.mock.calls[0] ?? []),
    );
    useStore.getState().setProject(projectWith(original));
    useStore.getState().cropImage(original.id, cropped);
    expect(roundTrip(useStore.getState().project).scene.objects[0]).toMatchObject({
      lumaBase64: lumaToBase64(Uint8Array.of(20, 30, 60, 70)),
    });
    expect(await hydratePagedRasterImage(currentImage(), pages)).toBe(currentImage());
    useStore.getState().undo();
    expect(currentImage()).toBe(original);
    useStore.getState().redo();
    expect(currentImage()).not.toHaveProperty('imageAsset');
    expect(collectPagedRasterAssetIds(useStore.getState())).toEqual(
      new Set([ASSET.sourceAssetId, ASSET.lumaAssetId]),
    );
  });

  it('does not publish white pixels when paged luma is incomplete, and releases its lease', async () => {
    const original = { ...image(), imageMaskId: 'mask' };
    const mask = createRectangle({
      id: 'mask',
      color: '#000000',
      spec: { widthMm: 2, heightMm: 2, cornerRadiusMm: 0 },
      transform: IDENTITY_TRANSFORM,
    });
    const pages = repository(Uint8Array.of(0));
    const encoded = vi.fn(() => ({ dataUrl: EDITED_URL, lumaBase64: '' }));
    await expect(cropMaskedRasterImage(original, mask, encoded, pages)).rejects.toThrow(
      'has 1 bytes; expected 8',
    );
    expect(encoded).not.toHaveBeenCalled();
    expect(pages.releaseReadLease).toHaveBeenCalledOnce();
    expect(original.imageAsset).toBe(ASSET);
  });
});
