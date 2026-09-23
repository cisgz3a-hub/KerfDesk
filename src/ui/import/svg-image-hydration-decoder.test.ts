import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import type { ParsedSvgFragment, SvgImageDescriptor } from '../../io/svg/svg-import-fragment';
import { IndexedDbPagedAssetRepository } from './paged-asset-indexeddb';
import { makePng } from './png-incremental-decoder.test-support';
import { prepareSvgFragment } from './svg-image-hydration';
import {
  installSvgImageTestEnvironment,
  resetSvgImageTestEnvironment,
  realPng,
  pngWorkerRequests as requests,
} from './svg-image-hydration.test-support';

const bounds = { minX: -12, minY: 8, maxX: 28, maxY: 28 };

function pngDescriptor(id: string, bytes: Uint8Array): SvgImageDescriptor {
  return {
    kind: 'svg-image',
    id,
    source: 'real-embedded.svg',
    dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
    bounds,
    transform: {
      ...IDENTITY_TRANSFORM,
      x: -32,
      y: 49,
      scaleX: 1.5,
      scaleY: 0.75,
      rotationDeg: 31,
      mirrorX: true,
      mirrorY: true,
    },
  };
}

function fragment(...entries: ParsedSvgFragment['entries']): ParsedSvgFragment {
  return { source: 'real-embedded.svg', bounds, entries };
}

async function expectTemporaryPagesRemoved(): Promise<void> {
  const repository = new IndexedDbPagedAssetRepository();
  for (const request of requests) {
    for (const assetId of [request.options.assetId, request.options.lumaAssetId]) {
      await expect(repository.readManifest(assetId)).resolves.toBeNull();
      await expect(repository.readPage(assetId, 0)).resolves.toBeNull();
    }
  }
}

describe('prepareSvgFragment with the production PNG decoder', () => {
  beforeEach(installSvgImageTestEnvironment);
  afterEach(resetSvgImageTestEnvironment);

  it('decodes actual bitmap samples and preserves authored SVG placement despite PNG density', async () => {
    const descriptor = pngDescriptor('real-image', realPng());
    const prepared = await prepareSvgFragment(fragment(descriptor));
    const image = prepared.objects[0] as RasterImage;

    expect(requests).toHaveLength(1);
    expect(image).toMatchObject({
      kind: 'raster-image',
      id: descriptor.id,
      source: descriptor.source,
      dataUrl: descriptor.dataUrl,
      pixelWidth: 8192,
      pixelHeight: 1,
      bounds: descriptor.bounds,
      transform: descriptor.transform,
    });
    const luma = Uint8Array.from(atob(image.lumaBase64 ?? ''), (value) => value.charCodeAt(0));
    expect(luma).toHaveLength(image.pixelWidth * image.pixelHeight);
    expect([...new Set(luma.slice(0, 4000))]).toEqual([0]);
    expect([...new Set(luma.slice(-4000))]).toEqual([255]);
    expect(image).not.toHaveProperty('imageAsset');
    await expectTemporaryPagesRemoved();
    prepared.commit();
    await prepared.rollback();
  });

  it('fails the whole fragment for a corrupt second PNG and removes all temporary pages', async () => {
    const bytes = realPng();
    const corrupt = bytes.slice(0, -15);
    const pending = prepareSvgFragment(
      fragment(pngDescriptor('first', bytes), pngDescriptor('broken', corrupt)),
    );

    await expect(pending).rejects.toThrow();
    expect(requests).toHaveLength(2);
    await expectTemporaryPagesRemoved();
  });

  it('decodes permitted whitespace between embedded base64 characters', async () => {
    const descriptor = pngDescriptor('wrapped', realPng());
    const [prefix = '', payload = ''] = descriptor.dataUrl.split(',');
    const wrapped = `${prefix}, \n ${payload.replace(/(.{5})/g, '$1\n\t ')} \n`;
    const prepared = await prepareSvgFragment(fragment({ ...descriptor, dataUrl: wrapped }));

    expect(prepared.objects[0]).toMatchObject({ pixelWidth: 8192, pixelHeight: 1 });
    expect(requests).toHaveLength(1);
    await expectTemporaryPagesRemoved();
    await prepared.rollback();
  });

  it('rejects invalid encoded row data through the default preparation path', async () => {
    const bytes = makePng({
      width: 20_000,
      height: 1,
      colorType: 0,
      rows: [[0, 255]], // Honest IHDR but incomplete decoded samples.
    });

    await expect(prepareSvgFragment(fragment(pngDescriptor('bad-row', bytes)))).rejects.toThrow();
    expect(requests).toHaveLength(1);
    await expectTemporaryPagesRemoved();
  });
});
