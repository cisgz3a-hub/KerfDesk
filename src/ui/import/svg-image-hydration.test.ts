import { File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import type { ParsedSvgFragment, SvgImageDescriptor } from '../../io/svg/svg-import-fragment';
import { loadImageSamples, type LoadedImageSamples } from './prepare-image-samples';
import { prepareSvgFragment } from './svg-image-hydration';
import { makePng } from './png-incremental-decoder.test-support';

// Only this ownership suite replaces sample preparation. The companion decoder
// suite reconstructs real PNG bytes and executes the production PNG pipeline.
vi.mock('./prepare-image-samples', () => ({ loadImageSamples: vi.fn() }));

const png = makePng({ width: 2, height: 1, rows: [[0, 0, 0, 255, 255, 255]] });
const dataUrl = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
const bounds = { minX: -10, minY: 5, maxX: 30, maxY: 25 };
const embedded: LoadedImageSamples = {
  kind: 'embedded',
  natural: { width: 2, height: 1 },
  sampled: { width: 2, height: 1 },
  lumaBase64: 'AP8=',
  density: { xDpi: 1200, yDpi: 300 },
};

function image(id: string, overrides: Partial<SvgImageDescriptor> = {}): SvgImageDescriptor {
  return {
    kind: 'svg-image',
    id,
    source: 'mixed.svg',
    dataUrl,
    bounds,
    transform: { ...IDENTITY_TRANSFORM, x: 48, y: -26, rotationDeg: 32, mirrorX: true },
    ...overrides,
  };
}

function fragment(...entries: ParsedSvgFragment['entries']): ParsedSvgFragment {
  return { source: 'mixed.svg', bounds, entries };
}

function paged(rollback: () => Promise<string | null>): LoadedImageSamples {
  return {
    kind: 'paged',
    natural: { width: 2, height: 1 },
    sampled: { width: 2, height: 1 },
    density: null,
    rollback,
    imageAsset: {
      schemaVersion: 1,
      repository: 'curvedesk-import-assets-v1',
      sourceAssetId: 'source',
      lumaAssetId: 'luma',
      sourceMimeType: 'image/png',
      sourceByteLength: png.length,
      lumaByteLength: 2,
      naturalWidth: 2,
      naturalHeight: 1,
      sampledWidth: 2,
      sampledHeight: 1,
      thumbnail: {
        mimeType: 'image/bmp',
        dataUrl: 'data:image/bmp;base64,Qk0=',
        width: 2,
        height: 1,
      },
    },
  };
}

describe('prepareSvgFragment ownership', () => {
  beforeEach(() => {
    vi.stubGlobal('File', NodeFile);
    vi.mocked(loadImageSamples).mockReset().mockResolvedValue(embedded);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('preserves vector/image order, local clips, and SVG placement instead of bitmap DPI', async () => {
    const vector: ImportedSvg = {
      kind: 'imported-svg',
      id: 'vector',
      source: 'mixed.svg',
      bounds,
      transform: IDENTITY_TRANSFORM,
      paths: [],
    };
    const imageClip = [{ color: '#000000', fillRule: 'evenodd' as const, polylines: [] }];
    const first = image('first', { imageClip });
    const last = image('last', {
      transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 0.5, mirrorY: true },
    });
    const prepared = await prepareSvgFragment(fragment(first, vector, last));

    expect(prepared.objects.map((object) => object.id)).toEqual(['first', 'vector', 'last']);
    expect(prepared.objects[1]).toBe(vector);
    expect(prepared.objects[0]).toMatchObject({
      kind: 'raster-image',
      id: first.id,
      source: first.source,
      dataUrl,
      lumaBase64: 'AP8=',
      pixelWidth: 2,
      pixelHeight: 1,
      bounds,
      transform: first.transform,
      imageClip,
    });
    expect(prepared.objects[2]?.transform).toEqual(last.transform);
    expect(prepared.objects[0]).not.toHaveProperty('imageAsset');
    prepared.commit();
    await prepared.rollback();
  });

  it('keeps paged assets staged until commit and never removes committed resources', async () => {
    const rollback = vi.fn(async () => null);
    vi.mocked(loadImageSamples).mockResolvedValue(paged(rollback));
    const prepared = await prepareSvgFragment(fragment(image('paged')));

    expect(prepared.objects[0]).toMatchObject({
      imageAsset: { sourceAssetId: 'source', lumaAssetId: 'luma' },
      pixelWidth: 2,
      pixelHeight: 1,
      bounds,
    });
    expect(prepared.objects[0]).not.toHaveProperty('dataUrl');
    expect(rollback).not.toHaveBeenCalled();
    prepared.commit();
    prepared.commit();
    await prepared.rollback();
    expect(rollback).not.toHaveBeenCalled();
  });

  it('rolls back all staged images exactly once when the caller cannot insert the fragment', async () => {
    const first = vi.fn(async () => null);
    const second = vi.fn(async () => null);
    vi.mocked(loadImageSamples)
      .mockResolvedValueOnce(paged(first))
      .mockResolvedValueOnce(paged(second));
    const prepared = await prepareSvgFragment(fragment(image('first'), image('second')));

    await Promise.all([prepared.rollback(), prepared.rollback()]);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(() => prepared.commit()).toThrow('after rollback');
  });

  it('rolls back the first image if decoding the second fails', async () => {
    const rollback = vi.fn(async () => null);
    vi.mocked(loadImageSamples)
      .mockResolvedValueOnce(paged(rollback))
      .mockRejectedValueOnce(new Error('Image bytes cannot be decoded'));

    await expect(prepareSvgFragment(fragment(image('first'), image('broken')))).rejects.toThrow(
      'Image bytes cannot be decoded',
    );
    expect(rollback).toHaveBeenCalledOnce();
  });

  it('owns a just-decoded paged image before observing cancellation', async () => {
    const controller = new AbortController();
    const first = vi.fn(async () => null);
    const second = vi.fn(async () => null);
    vi.mocked(loadImageSamples)
      .mockResolvedValueOnce(paged(first))
      .mockImplementationOnce(async () => {
        controller.abort();
        return paged(second);
      });

    await expect(
      prepareSvgFragment(fragment(image('first'), image('second')), {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('does no decoding for an already-cancelled fragment', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      prepareSvgFragment(fragment(image('first')), {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadImageSamples).not.toHaveBeenCalled();
  });

  it('yields during large embedded source reconstruction and honours cancellation', async () => {
    const controller = new AbortController();
    const largeDataUrl = `data:image/png;base64,${'A'.repeat(2 * 1_048_576)}`;
    const pending = prepareSvgFragment(fragment(image('large', { dataUrl: largeDataUrl })), {
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadImageSamples).not.toHaveBeenCalled();
  });

  it('stages images sequentially instead of retaining concurrent full bitmap decodes', async () => {
    let finishFirst: ((result: LoadedImageSamples) => void) | undefined;
    vi.mocked(loadImageSamples).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    const pending = prepareSvgFragment(fragment(image('first'), image('second')));
    await vi.waitFor(() => expect(loadImageSamples).toHaveBeenCalledOnce());
    finishFirst?.(embedded);

    const prepared = await pending;
    expect(loadImageSamples).toHaveBeenCalledTimes(2);
    expect(prepared.objects).toHaveLength(2);
    await prepared.rollback();
  });

  it('reports failed temporary cleanup for an embedded worker result', async () => {
    vi.mocked(loadImageSamples).mockResolvedValue({
      ...embedded,
      cleanupWarning: 'Temporary PNG import pages could not be removed',
    });
    await expect(prepareSvgFragment(fragment(image('image')))).rejects.toThrow(
      'Temporary PNG import pages could not be removed',
    );
  });

  it('attempts every cleanup and reports both decode and cleanup failures', async () => {
    const first = vi.fn(async () => null);
    const second = vi.fn(async () => 'Temporary pages could not be removed');
    vi.mocked(loadImageSamples)
      .mockResolvedValueOnce(paged(first))
      .mockResolvedValueOnce(paged(second))
      .mockRejectedValueOnce(new Error('Corrupt third bitmap'));
    const pending = prepareSvgFragment(fragment(image('first'), image('second'), image('third')));

    await expect(pending).rejects.toThrow(
      /Corrupt third bitmap.*Temporary pages could not be removed/,
    );
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it.each([
    'https://example.com/image.png',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/png,plain-data',
    'data:image/png;base64,',
    'data:image/png;base64,AQ?ID',
    'data:image/png;base64,  \n\t  ',
    'data:image/png;base64,AQ==\nID==',
    'data:image/png;base64,A===',
  ])('rejects unsupported or malformed image URLs before decoding: %s', async (source) => {
    await expect(prepareSvgFragment(fragment(image('bad', { dataUrl: source })))).rejects.toThrow();
    expect(loadImageSamples).not.toHaveBeenCalled();
  });
});
