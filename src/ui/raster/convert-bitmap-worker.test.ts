import { afterEach, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { assembleBitmap } from './bitmap-assembly';
import type {
  ConvertBitmapWorkerRequest,
  ConvertBitmapWorkerResponse,
} from './convert-bitmap-worker-protocol';
import { lumaToBase64 } from './luma-bitmap';

afterEach(() => vi.unstubAllGlobals());

it('the real worker handler renders serialized canonical curves with the same pixels and options as inline assembly', async () => {
  const encodedPixels: Uint8ClampedArray[] = [];
  class TestCanvas {
    getContext() {
      return {
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        }),
        putImageData: (image: { data: Uint8ClampedArray }) => encodedPixels.push(image.data),
      };
    }
    async convertToBlob() {
      return new Blob(['test-png']);
    }
  }
  class TestFileReader {
    readAsDataURL() {
      return 'data:image/png;base64,test';
    }
  }
  const workerSelf = {
    onmessage: null as ((event: MessageEvent<ConvertBitmapWorkerRequest>) => void) | null,
    postMessage: vi.fn<(response: ConvertBitmapWorkerResponse) => void>(),
  };
  vi.stubGlobal('self', workerSelf);
  vi.stubGlobal('OffscreenCanvas', TestCanvas);
  vi.stubGlobal('FileReaderSync', TestFileReader);
  await import('./convert-bitmap-worker');

  const source: ImportedSvg = {
    kind: 'imported-svg',
    id: 'source',
    source: 'curves.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, scaleX: 2, rotationDeg: 90, mirrorX: true, x: 10, y: 20 },
    operationIds: ['line-operation'],
    paths: [
      {
        color: '#ff0000',
        polylines: [],
        curves: [
          {
            start: { x: 0, y: 0 },
            closed: true,
            segments: [
              { kind: 'line', to: { x: 10, y: 0 } },
              { kind: 'line', to: { x: 10, y: 10 } },
              { kind: 'line', to: { x: 0, y: 10 } },
            ],
          },
        ],
      },
    ],
  };
  const before = structuredClone(source);
  for (const renderType of ['fill-all', 'outlines', 'use-cut-settings'] as const) {
    const request: ConvertBitmapWorkerRequest = {
      id: 42,
      rasterId: 'bitmap',
      vectors: [source],
      options: {
        dpi: 254,
        brightnessPercent: 80,
        renderType,
        layers: [{ id: 'line-operation', color: '#000000', mode: 'line' }],
      },
    };
    const responsePromise = new Promise<ConvertBitmapWorkerResponse>((resolve) => {
      workerSelf.postMessage.mockImplementationOnce(resolve);
    });
    if (workerSelf.onmessage === null) throw new Error('expected installed worker handler');
    workerSelf.onmessage({
      data: structuredClone(request),
    } as MessageEvent<ConvertBitmapWorkerRequest>);
    const response = await responsePromise;
    if (response.kind !== 'ok') throw new Error(response.message);
    const inline = assembleBitmap(
      [source],
      (raster) => ({
        dataUrl: 'data:image/png;base64,test',
        lumaBase64: lumaToBase64(raster.luma),
      }),
      'bitmap',
      request.options,
    );
    expect(response.raster).toEqual(inline);
    expect(response.raster.pixelWidth).toBe(100);
    expect(response.raster.pixelHeight).toBe(200);
    const pixels = atob(response.raster.lumaBase64 ?? '');
    expect(pixels.includes(String.fromCharCode(204))).toBe(true);
    expect(pixels.charCodeAt(100 * 100 + 50)).toBe(renderType === 'fill-all' ? 204 : 255);
  }
  expect(encodedPixels).toHaveLength(3);
  expect(encodedPixels.every((pixels) => pixels.some((value) => value === 204))).toBe(true);
  expect(source).toEqual(before);
});
