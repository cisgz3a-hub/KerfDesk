import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { drawRasterPreview } from './draw-raster-preview';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('drawRasterPreview async cache fill', () => {
  it('schedules raster preview canvas generation outside the draw call', () => {
    vi.useFakeTimers();
    vi.stubGlobal('ImageData', FakeImageData);
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
      return {
        width: 0,
        height: 0,
        getContext: () => ({ putImageData: vi.fn() }),
      } as unknown as HTMLCanvasElement;
    });
    const onRasterPreviewReady = vi.fn();
    const project = {
      ...createProject(),
      scene: {
        objects: [burnRaster()],
        layers: [createLayer({ id: 'image', color: '#808080', mode: 'image' })],
      },
    };

    drawRasterPreview(
      noOpContext(),
      project,
      { scale: 1, offsetX: 0, offsetY: 0 },
      {
        onRasterPreviewReady,
      },
    );

    expect(createElement).not.toHaveBeenCalled();
    expect(onRasterPreviewReady).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();

    expect(createElement).toHaveBeenCalledTimes(1);
    expect(onRasterPreviewReady).toHaveBeenCalledTimes(1);
  });
});

class FakeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

function burnRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R-async',
    source: 'source.png',
    dataUrl: 'data:image/png;base64,async-preview',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
  };
}

function noOpContext(): CanvasRenderingContext2D {
  return new Proxy(
    {},
    {
      get() {
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
}
