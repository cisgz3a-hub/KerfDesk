import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  addLayer,
  addObject,
  createLayer,
  createProject,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import type { PagedAssetManifest } from './paged-asset-stager';
import { hydratePagedRasterProject } from './paged-raster-hydration';
import { buildProcessedRasterBitmap } from '../raster/processed-bitmap';

const IMAGE_ASSET: NonNullable<RasterImage['imageAsset']> = {
  schemaVersion: 1,
  repository: 'curvedesk-import-assets-v1',
  sourceAssetId: 'source-pages',
  lumaAssetId: 'luma-pages',
  sourceMimeType: 'image/png',
  sourceByteLength: 300_000_000,
  lumaByteLength: 2,
  naturalWidth: 2,
  naturalHeight: 1,
  sampledWidth: 2,
  sampledHeight: 1,
  thumbnail: {
    mimeType: 'image/bmp',
    dataUrl: 'data:image/bmp;base64,thumbnail',
    width: 2,
    height: 1,
  },
};

describe('page-backed raster luma hydration', () => {
  it('preserves burn-preview pixels without retaining luma on the scene object', async () => {
    const pageBacked = pageBackedProject();
    const hydrated = await hydratePagedRasterProject(pageBacked, repository(Uint8Array.of(0, 255)));
    const embedded = embeddedProject();
    const hydratedImage = raster(hydrated);
    const embeddedImage = raster(embedded);
    const layer = hydrated.scene.layers[0];
    if (layer === undefined) throw new Error('missing image layer');

    expect(raster(pageBacked)).not.toHaveProperty('lumaBase64');
    expect(buildProcessedRasterBitmap(hydratedImage, layer, hydrated.device)).toEqual(
      buildProcessedRasterBitmap(embeddedImage, layer, embedded.device),
    );
  });

  it('emits the same raster G-code bytes as the embedded-luma path', async () => {
    const hydrated = await hydratePagedRasterProject(
      pageBackedProject(),
      repository(Uint8Array.of(0, 255)),
    );
    const pagedPrepared = prepareOutput(hydrated);
    const embeddedPrepared = prepareOutput(embeddedProject());

    expect(pagedPrepared.ok).toBe(true);
    expect(embeddedPrepared.ok).toBe(true);
    expect(emitPreparedGcode(pagedPrepared).gcode).toBe(emitPreparedGcode(embeddedPrepared).gcode);
    expect(emitPreparedGcode(pagedPrepared).gcode).toContain('S300');
  });

  it('fails only when the referenced luma asset is unavailable or corrupt', async () => {
    await expect(
      hydratePagedRasterProject(pageBackedProject(), repository(Uint8Array.of(0))),
    ).rejects.toThrow('has 1 bytes; expected 2');
  });

  it('stops page hydration when the preview request is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      hydratePagedRasterProject(
        pageBackedProject(),
        repository(Uint8Array.of(0, 255)),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

function pageBackedProject(): Project {
  return rasterProject({
    kind: 'raster-image',
    id: 'paged-image',
    source: 'large.png',
    imageAsset: IMAGE_ASSET,
    pixelWidth: 2,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#111111',
    dither: 'threshold',
    linesPerMm: 1,
  });
}

function embeddedProject(): Project {
  return rasterProject({
    kind: 'raster-image',
    id: 'embedded-image',
    source: 'small.png',
    dataUrl: 'data:image/png;base64,source',
    lumaBase64: 'AP8=',
    pixelWidth: 2,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#111111',
    dither: 'threshold',
    linesPerMm: 1,
  });
}

function rasterProject(image: RasterImage): Project {
  const base = createProject();
  return {
    ...base,
    scene: addLayer(addObject(base.scene, image), {
      ...createLayer({ id: 'image', color: image.color, mode: 'image' }),
      ditherAlgorithm: 'threshold',
      linesPerMm: 1,
      fillOverscanMm: 0,
    }),
  };
}

function raster(project: Project): RasterImage {
  const image = project.scene.objects.find((object) => object.kind === 'raster-image');
  if (image?.kind !== 'raster-image') throw new Error('missing raster image');
  return image;
}

function repository(bytes: Uint8Array) {
  const manifest: PagedAssetManifest = {
    schemaVersion: 1,
    assetId: IMAGE_ASSET.lumaAssetId,
    sourceName: 'large.png.luma',
    mimeType: 'application/x-curvedesk-luma',
    byteLength: IMAGE_ASSET.lumaByteLength,
    writtenByteLength: IMAGE_ASSET.lumaByteLength,
    pageBytes: 1,
    pageCount: bytes.length,
    createdAtEpochMs: 1,
    state: 'ready',
  };
  return {
    readManifest: async () => manifest,
    readAssetChunks: async function* () {
      for (const byte of bytes) yield Uint8Array.of(byte);
    },
  };
}
