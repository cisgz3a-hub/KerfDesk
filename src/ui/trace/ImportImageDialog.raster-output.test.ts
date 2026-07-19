import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./image-loader', () => ({
  PREVIEW_MAX_EDGE_PX: 2048,
  loadImageAsRawData: vi.fn(async () => ({
    width: 2,
    height: 2,
    data: new Uint8ClampedArray(16),
  })),
}));
vi.mock('./use-trace-worker-client', () => ({
  traceImageWithFallback: vi.fn(async () => ({
    paths: [{ color: '#000000', polylines: [] }],
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    width: 2,
    height: 2,
  })),
}));
vi.mock('../raster/vector-to-bitmap', () => ({
  buildBitmapFromVectors: vi.fn(async () => ({
    kind: 'raster-image' as const,
    id: 'raster-trace-1',
    source: 'logo.png (bitmap)',
    dataUrl: 'data:image/png;base64,TRACE',
    pixelWidth: 500,
    pixelHeight: 400,
    bounds: { minX: 0, minY: 0, maxX: 50, maxY: 40 },
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      mirrorX: false,
      mirrorY: false,
    },
    color: '#808080',
    dither: 'floyd-steinberg' as const,
    linesPerMm: 10,
    lumaBase64: 'AAAA',
  })),
}));

import {
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  captureLayerOperationSettings,
  createLayer,
  createLayerSubLayer,
  createProject,
  type Layer,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import { buildBitmapFromVectors } from '../raster/vector-to-bitmap';
import { commit } from './ImportImageDialog';

afterEach(() => {
  vi.mocked(buildBitmapFromVectors).mockClear();
});

function sourceRaster(over: Partial<RasterImage> = {}): RasterImage {
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
    operationIds: ['image-op'],
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    ...over,
  };
}

function imageOperation(over: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id: 'image-op', color: '#808080', mode: 'image' }), ...over };
}

function projectWith(source: RasterImage, operations: Layer | ReadonlyArray<Layer>): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: [source],
      layers: Array.isArray(operations) ? operations : [operations],
    },
  };
}

function context(getCurrentProject: () => Project) {
  return {
    traceExistingImage: vi.fn(),
    commitRasterizedTrace: vi.fn(),
    pushToast: vi.fn(),
    close: vi.fn(),
    setBusy: vi.fn(),
    getCurrentProject,
  };
}

function traceOptions(preset: string): TraceOptions {
  const options = TRACE_PRESETS[preset];
  if (options === undefined) throw new Error(`Missing trace preset ${preset}`);
  return options;
}

function commitArgs(source: RasterImage, preset: string) {
  return {
    file: new File([''], 'logo.png'),
    options: traceOptions(preset),
    seed: source,
    traceOutput: 'raster' as const,
    traceFillStyle: 'scanline' as const,
  };
}

const PRESET_OUTPUTS = [
  ['Line Art', 'filled-contours', 'fill-all'],
  ['Smooth', 'filled-contours', 'fill-all'],
  ['Sharp', 'filled-contours', 'fill-all'],
  ['Centerline', 'centerline', 'outlines'],
  ['Edge Detection', 'edge', 'outlines'],
] as const;

describe('Trace Image raster output', () => {
  it.each(PRESET_OUTPUTS)(
    'keeps the %s trace result in %s form and rasterizes it as %s',
    async (preset, expectedTraceMode, expectedRenderType) => {
      const source = sourceRaster();
      const operation = imageOperation({ linesPerMm: 12 });
      const project = projectWith(source, operation);
      const ctx = context(() => project);

      await commit(commitArgs(source, preset), ctx);

      expect(buildBitmapFromVectors).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            kind: 'traced-image',
            traceMode: expectedTraceMode,
            tracePixelWidth: 2,
            tracePixelHeight: 2,
          }),
        ],
        {
          dpi: expect.closeTo(304.8, 8),
          renderType: expectedRenderType,
          brightnessPercent: 0,
        },
      );
      expect(ctx.traceExistingImage).not.toHaveBeenCalled();
      expect(ctx.commitRasterizedTrace).toHaveBeenCalledWith(
        'src-1',
        expect.objectContaining({ kind: 'raster-image' }),
        { deleteSourceAfterTrace: false },
      );
      expect(ctx.close).toHaveBeenCalledTimes(1);
    },
  );

  it('uses an object-level Image density override for raster materialization', async () => {
    const source = sourceRaster({ operationOverride: { linesPerMm: 20 } });
    const operation = imageOperation({ linesPerMm: 12 });
    const project = projectWith(source, operation);
    const ctx = context(() => project);

    await commit(commitArgs(source, 'Line Art'), ctx);

    expect(buildBitmapFromVectors).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ dpi: 508 }),
    );
  });

  it('materializes at the highest density across every bound Image operation', async () => {
    const source = sourceRaster({ operationIds: ['image-op', 'detail-op'] });
    const lowDensity = imageOperation({ linesPerMm: 5 });
    const detail = {
      ...imageOperation({ linesPerMm: 20 }),
      id: 'detail-op',
      color: '#202020',
    };
    const project = projectWith(source, [lowDensity, detail]);
    const ctx = context(() => project);

    await commit(commitArgs(source, 'Line Art'), ctx);

    expect(buildBitmapFromVectors).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ dpi: 508 }),
    );
  });

  it('preserves the replaced trace id when rasterizing Re-trace Original', async () => {
    const source = sourceRaster();
    const operation = imageOperation();
    const project = projectWith(source, operation);
    const ctx = context(() => project);

    await commit({ ...commitArgs(source, 'Line Art'), replaceTraceId: 'existing-trace' }, ctx);

    expect(ctx.commitRasterizedTrace).toHaveBeenCalledWith(
      'src-1',
      expect.objectContaining({ id: 'existing-trace' }),
      { deleteSourceAfterTrace: false, replaceTraceId: 'existing-trace' },
    );
  });

  it('coerces a domain-level raster request to vectors for CNC projects', async () => {
    const source = sourceRaster();
    const operation = imageOperation();
    const project = {
      ...projectWith(source, operation),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
    };
    const ctx = context(() => project);

    await commit(commitArgs(source, 'Line Art'), ctx);

    expect(buildBitmapFromVectors).not.toHaveBeenCalled();
    expect(ctx.commitRasterizedTrace).not.toHaveBeenCalled();
    expect(ctx.traceExistingImage).toHaveBeenCalledTimes(1);
  });

  it('rejects a raster result if the machine switches to CNC during materialization', async () => {
    const source = sourceRaster();
    const operation = imageOperation();
    let project = projectWith(source, operation);
    const ctx = context(() => project);
    vi.mocked(buildBitmapFromVectors).mockImplementationOnce(async () => {
      project = { ...project, machine: DEFAULT_CNC_MACHINE_CONFIG };
      return sourceRaster({ id: 'raster-trace-1' });
    });

    await commit(commitArgs(source, 'Line Art'), ctx);

    expect(ctx.commitRasterizedTrace).not.toHaveBeenCalled();
    expect(ctx.traceExistingImage).not.toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('changed while the raster scan was being built'),
      'error',
    );
  });

  it('uses an enabled Image sublayer when the bound parent operation is Line', async () => {
    const source = sourceRaster();
    const parent = createLayer({ id: 'image-op', color: '#808080', mode: 'line' });
    const imageSubLayer = createLayerSubLayer(parent, {
      id: 'image-scan',
      label: 'Image scan',
      settings: {
        ...captureLayerOperationSettings(parent),
        mode: 'image',
        linesPerMm: 14,
      },
    });
    const project = projectWith(source, { ...parent, subLayers: [imageSubLayer] });
    const ctx = context(() => project);

    await commit(commitArgs(source, 'Line Art'), ctx);

    expect(buildBitmapFromVectors).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ dpi: expect.closeTo(355.6, 8) }),
    );
    expect(ctx.commitRasterizedTrace).toHaveBeenCalledTimes(1);
  });

  it('does not mutate when the source transform changes during bitmap materialization', async () => {
    const source = sourceRaster();
    const operation = imageOperation();
    let project = projectWith(source, operation);
    const ctx = context(() => project);
    vi.mocked(buildBitmapFromVectors).mockImplementationOnce(async () => {
      project = projectWith(
        sourceRaster({ transform: { ...IDENTITY_TRANSFORM, x: 5 } }),
        operation,
      );
      return sourceRaster({ id: 'raster-trace-1' });
    });

    await commit(commitArgs(source, 'Line Art'), ctx);

    expect(ctx.commitRasterizedTrace).not.toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('changed while the raster scan was being built'),
      'error',
    );
    expect(ctx.close).not.toHaveBeenCalled();
  });

  it('does not mutate when source Image settings change during bitmap materialization', async () => {
    const source = sourceRaster();
    const operation = imageOperation({ linesPerMm: 12 });
    let project = projectWith(source, operation);
    const ctx = context(() => project);
    vi.mocked(buildBitmapFromVectors).mockImplementationOnce(async () => {
      project = projectWith(source, { ...operation, linesPerMm: 20 });
      return sourceRaster({ id: 'raster-trace-1' });
    });

    await commit(commitArgs(source, 'Line Art'), ctx);

    expect(ctx.commitRasterizedTrace).not.toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('changed while the raster scan was being built'),
      'error',
    );
  });

  it('does not mutate when a secondary Image operation changes during materialization', async () => {
    const source = sourceRaster({ operationIds: ['image-op', 'detail-op'] });
    const primary = imageOperation({ linesPerMm: 5 });
    const secondary = {
      ...imageOperation({ linesPerMm: 20 }),
      id: 'detail-op',
      color: '#202020',
    };
    let project = projectWith(source, [primary, secondary]);
    const ctx = context(() => project);
    vi.mocked(buildBitmapFromVectors).mockImplementationOnce(async () => {
      project = projectWith(source, [primary, { ...secondary, linesPerMm: 18 }]);
      return sourceRaster({ id: 'raster-trace-1' });
    });

    await commit(commitArgs(source, 'Line Art'), ctx);

    expect(ctx.commitRasterizedTrace).not.toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('changed while the raster scan was being built'),
      'error',
    );
  });

  it('rejects unsupported Pass Through density without mutating or closing', async () => {
    const source = sourceRaster({
      bounds: { minX: 0, minY: 0, maxX: 0.05, maxY: 0.05 },
    });
    const operation = imageOperation({ linesPerMm: 5, passThrough: true });
    const project = projectWith(source, operation);
    const ctx = context(() => project);

    await commit(commitArgs(source, 'Line Art'), ctx);

    expect(buildBitmapFromVectors).not.toHaveBeenCalled();
    expect(ctx.commitRasterizedTrace).not.toHaveBeenCalled();
    expect(ctx.traceExistingImage).not.toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith(
      expect.stringMatching(/Pass Through needs 40\.00 lines\/mm.*choose Editable vectors/),
      'error',
    );
    expect(ctx.close).not.toHaveBeenCalled();
  });

  it('reports conversion failure without mutating or closing the dialog', async () => {
    const source = sourceRaster();
    const operation = imageOperation();
    const project = projectWith(source, operation);
    const ctx = context(() => project);
    vi.mocked(buildBitmapFromVectors).mockRejectedValueOnce(new Error('bitmap encoding failed'));

    await commit(commitArgs(source, 'Line Art'), ctx);

    expect(ctx.commitRasterizedTrace).not.toHaveBeenCalled();
    expect(ctx.traceExistingImage).not.toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('bitmap encoding failed'),
      'error',
    );
    expect(ctx.close).not.toHaveBeenCalled();
  });
});
