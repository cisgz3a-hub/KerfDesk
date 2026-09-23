import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  boundsFromColoredPaths,
  cropRawImageData,
  TRACE_PRESETS,
  traceImageToColoredPaths,
  type RawImageData,
  type TraceOptions,
} from '../../core/trace';
import type { ColoredPath } from '../../core/scene';
import { upscaleBy } from '../../core/trace/auto-upscale';
import { compositeRgbOverWhitePreservingAlpha } from './image-loader';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';

const photo = TRACE_PRESETS['Photo shading']!;

function uniform(r: number, g: number, b: number, alpha: number): RawImageData {
  const width = 8;
  const height = 6;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data.set([r, g, b, alpha], pixel * 4);
  }
  return { width, height, data };
}

function coverage(paths: ReadonlyArray<ColoredPath>, image: RawImageData): number {
  let area = 0;
  for (const path of paths) {
    for (const line of path.polylines) {
      let twice = 0;
      for (let i = 0; i < line.points.length; i += 1) {
        const a = line.points[i]!;
        const b = line.points[(i + 1) % line.points.length]!;
        twice += a.x * b.y - b.x * a.y;
      }
      area += Math.abs(twice) / 2;
    }
  }
  return area / (image.width * image.height);
}

async function traceCoverage(image: RawImageData, overrides: Partial<TraceOptions> = {}) {
  return coverage(await traceImageToColoredPaths(image, { ...photo, ...overrides }), image);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('decoded photo alpha representation', () => {
  it('applies partial alpha once after the real decoder white-compositing step', async () => {
    const raw = uniform(0, 0, 0, 128);
    const decoded = compositeRgbOverWhitePreservingAlpha(raw);
    expect(decoded.rgbCompositedOnWhite).toBe(true);
    expect([...decoded.data.slice(0, 4)]).toEqual([127, 127, 127, 128]);
    expect(await traceCoverage(decoded)).toBeCloseTo(128 / 255, 10);
    expect(await traceImageToColoredPaths(decoded, photo)).toEqual(
      await traceImageToColoredPaths(raw, photo),
    );
    expect(compositeRgbOverWhitePreservingAlpha(decoded)).toBe(decoded);
    expect(raw.rgbCompositedOnWhite).toBeUndefined();
    expect([...raw.data.slice(0, 4)]).toEqual([0, 0, 0, 128]);
  });

  it.each([0, 1, 16, 64, 128, 192, 254, 255])(
    'retains gray and colour coverage at source alpha %s within decoder byte rounding',
    async (alpha) => {
      for (const channels of [
        [0, 0, 0],
        [33, 33, 33],
        [128, 128, 128],
        [224, 224, 224],
        [255, 255, 255],
        [51, 147, 218],
      ] as const) {
        const raw = uniform(channels[0], channels[1], channels[2], alpha);
        const decoded = compositeRgbOverWhitePreservingAlpha(raw);
        const error = Math.abs((await traceCoverage(decoded)) - (await traceCoverage(raw)));
        expect(error).toBeLessThanOrEqual(1 / 255);
      }
    },
  );

  it.each([
    { brightness: 25 },
    { brightness: -25 },
    { contrast: 75 },
    { gamma: 1.8 },
    { invert: true },
    { brightness: -10, contrast: 40, gamma: 0.7, invert: true },
  ])('adjusts reconstructed source colour before alpha for %j', async (adjustment) => {
    for (const alpha of [32, 128, 224]) {
      const raw = uniform(64, 137, 202, alpha);
      const decoded = compositeRgbOverWhitePreservingAlpha(raw);
      const error = Math.abs(
        (await traceCoverage(decoded, adjustment)) - (await traceCoverage(raw, adjustment)),
      );
      expect(error).toBeLessThan(0.01);
    }
  });

  it('keeps fully transparent decoded pixels white when inverted and darkened', async () => {
    const decoded = compositeRgbOverWhitePreservingAlpha(uniform(44, 89, 132, 0));
    expect(
      await traceImageToColoredPaths(decoded, {
        ...photo,
        invert: true,
        brightness: -100,
        contrast: 100,
      }),
    ).toEqual([]);
  });

  it('preserves the representation through cropped and derived trace grids', async () => {
    const decoded = compositeRgbOverWhitePreservingAlpha(uniform(0, 0, 0, 128));
    const cropped = cropRawImageData(decoded, { x: 2, y: 1, width: 3, height: 4 });
    const enlarged = upscaleBy(cropped, 2);
    for (const image of [cropped, enlarged]) {
      expect(image.rgbCompositedOnWhite).toBe(true);
      expect(await traceCoverage(image)).toBeCloseTo(128 / 255, 10);
    }
  });

  it('carries the decoder representation with the copied worker buffer', async () => {
    vi.resetModules();
    let sentRequest: TraceWorkerRequest | undefined;
    let sentTransfer: ReadonlyArray<Transferable> | undefined;
    class TraceWorker {
      onmessage: ((event: MessageEvent<TraceWorkerResponse>) => void) | null = null;
      onerror: (() => void) | null = null;
      readonly terminate = vi.fn();

      postMessage(request: TraceWorkerRequest, transfer: ReadonlyArray<Transferable>): void {
        sentRequest = request;
        sentTransfer = transfer;
        void traceImageToColoredPaths(request.image, request.options).then((paths) => {
          this.onmessage?.({
            data: {
              id: request.id,
              kind: 'ok',
              paths,
              bounds: boundsFromColoredPaths(paths),
              width: request.image.width,
              height: request.image.height,
            },
          } as MessageEvent<TraceWorkerResponse>);
        });
      }
    }
    vi.stubGlobal('Worker', TraceWorker);
    const { traceImage } = await import('./use-trace-worker-client');
    const decoded = compositeRgbOverWhitePreservingAlpha(uniform(0, 0, 0, 128));
    const result = await traceImage(decoded, photo);
    expect(sentRequest?.image.rgbCompositedOnWhite).toBe(true);
    expect(sentRequest?.image.data).not.toBe(decoded.data);
    expect(sentTransfer?.[0]).toBe(sentRequest?.image.data.buffer);
    expect(decoded.data.byteLength).toBe(8 * 6 * 4);
    expect(coverage(result.paths, decoded)).toBeCloseTo(128 / 255, 10);
  });

  it('matches decoded coverage through the cooperative inline fallback', async () => {
    vi.resetModules();
    vi.stubGlobal('Worker', undefined);
    const { traceImage } = await import('./use-trace-worker-client');
    const decoded = compositeRgbOverWhitePreservingAlpha(uniform(0, 0, 0, 128));
    const result = await traceImage(decoded, photo);
    expect(coverage(result.paths, decoded)).toBeCloseTo(128 / 255, 10);
  });
});
