import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./image-loader', () => ({
  PREVIEW_MAX_EDGE_PX: 2048,
  loadImageAsRawData: vi.fn(async () => ({
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]),
  })),
  dataUrlToFile: vi.fn(async () => new File(['image'], 'logo.png', { type: 'image/png' })),
}));
vi.mock('./use-trace-worker-client', () => ({
  traceImageWithFallback: vi.fn(async () => ({
    paths: [{ color: '#000000', polylines: [] }],
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  })),
}));

import { IDENTITY_TRANSFORM, type RasterImage, type SceneObject } from '../../core/scene';
import { DEFAULT_TRACE_OPTIONS, type TraceBoundary } from '../../core/trace';
import { commit, sameTraceSource } from './ImportImageDialog';
import { traceImageWithFallback } from './use-trace-worker-client';

afterEach(() => {
  vi.mocked(traceImageWithFallback).mockClear();
});

function seedRaster(over: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id: 'src-1',
    source: 'logo.png',
    dataUrl: 'data:image/png;base64,AAA',
    pixelWidth: 100,
    pixelHeight: 80,
    bounds: { minX: 0, minY: 0, maxX: 50, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    ...over,
  };
}

function ctxWith(getCurrentObject: (id: string) => SceneObject | undefined) {
  return {
    traceExistingImage: vi.fn(),
    pushToast: vi.fn(),
    close: vi.fn(),
    setBusy: vi.fn(),
    getCurrentObject,
  };
}

const args = (
  seed: RasterImage,
  overrides: {
    readonly deleteSourceAfterTrace?: boolean;
    readonly boundary?: TraceBoundary | null;
  } = {},
) => ({
  file: new File([''], 'logo.png'),
  options: DEFAULT_TRACE_OPTIONS,
  seed,
  traceFillStyle: 'scanline' as const,
  ...overrides,
});

describe('sameTraceSource', () => {
  const seed = seedRaster();
  it('true when the live source is unchanged', () => {
    expect(sameTraceSource(seedRaster(), seed)).toBe(true);
  });
  it('false when the source was removed', () => {
    expect(sameTraceSource(undefined, seed)).toBe(false);
  });
  it('false when the image content (dataUrl) changed', () => {
    expect(sameTraceSource(seedRaster({ dataUrl: 'data:image/png;base64,BBB' }), seed)).toBe(false);
  });
  it('false when the pixel grid changed', () => {
    expect(sameTraceSource(seedRaster({ pixelWidth: 200 }), seed)).toBe(false);
  });
  it('false when the object is no longer a raster', () => {
    const svg: SceneObject = {
      kind: 'imported-svg',
      id: 'src-1',
      source: 'logo.svg',
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: IDENTITY_TRANSFORM,
      paths: [],
    };
    expect(sameTraceSource(svg, seed)).toBe(false);
  });
});

describe('commit source revalidation (P2-A)', () => {
  it('commits when the live source is unchanged', async () => {
    const seed = seedRaster();
    const ctx = ctxWith(() => seedRaster());
    await commit(args(seed), ctx);
    expect(ctx.traceExistingImage).toHaveBeenCalledTimes(1);
    expect(ctx.traceExistingImage).toHaveBeenCalledWith(
      'src-1',
      expect.objectContaining({ kind: 'traced-image' }),
      { deleteSourceAfterTrace: false },
    );
    expect(ctx.pushToast).toHaveBeenCalledWith(expect.stringContaining('source kept'), 'success');
  });

  it('applies Scanline as an object-level fill override', async () => {
    const seed = seedRaster();
    const ctx = ctxWith(() => seedRaster());
    await commit(args(seed), ctx);
    expect(ctx.traceExistingImage).toHaveBeenCalledWith(
      'src-1',
      expect.objectContaining({
        kind: 'traced-image',
        traceMode: 'filled-contours',
        operationOverride: { mode: 'fill', fillStyle: 'scanline' },
      }),
      { deleteSourceAfterTrace: false },
    );
  });

  it('applies Follow Shape as an object-level offset fill override', async () => {
    const seed = seedRaster();
    const ctx = ctxWith(() => seedRaster());
    await commit({ ...args(seed), traceFillStyle: 'offset' }, ctx);
    expect(ctx.traceExistingImage).toHaveBeenCalledWith(
      'src-1',
      expect.objectContaining({
        kind: 'traced-image',
        traceMode: 'filled-contours',
        operationOverride: { mode: 'fill', fillStyle: 'offset' },
      }),
      { deleteSourceAfterTrace: false },
    );
  });

  it('applies Island Fill as an object-level island fill override', async () => {
    const seed = seedRaster();
    const ctx = ctxWith(() => seedRaster());
    await commit({ ...args(seed), traceFillStyle: 'island' as never }, ctx);
    expect(ctx.traceExistingImage).toHaveBeenCalledWith(
      'src-1',
      expect.objectContaining({
        kind: 'traced-image',
        traceMode: 'filled-contours',
        operationOverride: { mode: 'fill', fillStyle: 'island' },
      }),
      { deleteSourceAfterTrace: false },
    );
  });

  it('passes Delete Image After trace through commit and reports source deleted', async () => {
    const seed = seedRaster();
    const ctx = ctxWith(() => seedRaster());
    await commit(args(seed, { deleteSourceAfterTrace: true }), ctx);
    expect(ctx.traceExistingImage).toHaveBeenCalledWith(
      'src-1',
      expect.objectContaining({ kind: 'traced-image' }),
      { deleteSourceAfterTrace: true },
    );
    expect(ctx.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('source deleted'),
      'success',
    );
  });

  it('commits a bounded trace in source-image coordinates', async () => {
    vi.mocked(traceImageWithFallback).mockResolvedValueOnce({
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 1, y: 2 },
              ],
            },
          ],
        },
      ],
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 2 },
    });
    const seed = seedRaster();
    const ctx = ctxWith(() => seedRaster());
    await commit(args(seed, { boundary: { x: 1, y: 0, width: 1, height: 2 } }), ctx);

    expect(traceImageWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1, height: 2 }),
      DEFAULT_TRACE_OPTIONS,
    );
    expect(ctx.traceExistingImage).toHaveBeenCalledWith(
      'src-1',
      expect.objectContaining({
        bounds: { minX: 1, minY: 0, maxX: 2, maxY: 2 },
        paths: [
          {
            color: '#000000',
            polylines: [
              {
                closed: false,
                points: [
                  { x: 1, y: 0 },
                  { x: 2, y: 2 },
                ],
              },
            ],
          },
        ],
      }),
      { deleteSourceAfterTrace: false },
    );
  });

  it('aborts (no overlay) when the live source content changed mid-dialog', async () => {
    const seed = seedRaster();
    const ctx = ctxWith(() => seedRaster({ dataUrl: 'data:image/png;base64,BBB' }));
    await commit(args(seed), ctx);
    expect(ctx.traceExistingImage).not.toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('changed or was removed'),
      'error',
    );
  });

  it('aborts when the live source was removed mid-dialog', async () => {
    const seed = seedRaster();
    const ctx = ctxWith(() => undefined);
    await commit(args(seed), ctx);
    expect(ctx.traceExistingImage).not.toHaveBeenCalled();
  });
});
