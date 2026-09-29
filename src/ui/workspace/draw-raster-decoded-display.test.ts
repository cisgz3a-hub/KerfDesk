// ADR-359 Amendment 1: a plain picture is blitted from its decoded display copy
// once that lands, and from a halved level of it when shown small, so zooming
// never hands Chromium the lazily decoded <img> to re-decode on the main thread.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import { drawRasterImage, pruneRasterImageCaches } from './draw-raster';
import type { ViewTransform } from './view-transform';

class LoadedImage {
  complete = true;
  naturalWidth = 4000;
  naturalHeight = 3000;
  src = '';
  onload: (() => void) | null = null;
}

class FakeImageBitmap {
  readonly close = vi.fn();
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
}

let decodes = 0;

beforeEach(() => {
  decodes = 0;
  vi.stubGlobal('Image', LoadedImage);
  vi.stubGlobal('ImageBitmap', FakeImageBitmap);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      decodes += 1;
      return new FakeImageBitmap(4000, 3000);
    }),
  );
});

afterEach(() => {
  pruneRasterImageCaches(new Set());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// 400 x 300 mm picture; at 10 px/mm it covers 4000 x 3000 px, at 1 px/mm 400 x 300.
const CLOSE_UP: ViewTransform = { scale: 10, offsetX: 0, offsetY: 0 };
const FIT: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };

describe('drawRasterImage decoded display copy', () => {
  it('draws the <img> until the decoded copy lands, then the copy', async () => {
    const onBitmapReady = vi.fn();
    const picture = pictureAt('data:image/jpeg;base64,/9j/AAAA');
    const first = recordingContext();
    drawRasterImage(first.ctx, picture, CLOSE_UP, { onBitmapReady });
    expect(first.sources[0]).toBeInstanceOf(LoadedImage);

    await settle();
    expect(onBitmapReady).toHaveBeenCalledTimes(1);
    const next = recordingContext();
    drawRasterImage(next.ctx, picture, CLOSE_UP, { onBitmapReady });

    expect(next.sources[0]).toBeInstanceOf(FakeImageBitmap);
    expect(next.rects[0]).toEqual([0, 0, 400, 300]);
    expect(decodes).toBe(1);
  });

  it('draws a halved level of the copy when the picture is shown small', async () => {
    const picture = pictureAt('data:image/jpeg;base64,/9j/AAAB');
    drawRasterImage(recordingContext().ctx, picture, FIT);
    await settle();

    const frame = recordingContext();
    drawRasterImage(frame.ctx, picture, FIT);

    const drawn = frame.sources[0] as HTMLCanvasElement;
    expect(drawn).toBeInstanceOf(HTMLCanvasElement);
    // 4000 -> 2000 -> 1000 -> 500: the smallest level still covering 400 px.
    expect([drawn.width, drawn.height]).toEqual([500, 375]);
    expect(frame.rects[0]).toEqual([0, 0, 400, 300]);
  });

  it('keeps adjusted and trace-source pictures on their own display copies', async () => {
    const adjusted = { ...pictureAt('data:image/jpeg;base64,/9j/AAAC'), brightness: 20 };
    const traceSource = {
      ...pictureAt('data:image/jpeg;base64,/9j/AAAD'),
      role: 'trace-source' as const,
    };
    drawRasterImage(recordingContext().ctx, adjusted, CLOSE_UP);
    drawRasterImage(recordingContext().ctx, traceSource, CLOSE_UP);
    await settle();

    expect(decodes).toBe(0);
  });
});

function pictureAt(dataUrl: string): Parameters<typeof drawRasterImage>[1] {
  return {
    dataUrl,
    bounds: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
    transform: IDENTITY_TRANSFORM,
  };
}

function recordingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly sources: CanvasImageSource[];
  readonly rects: number[][];
} {
  const sources: CanvasImageSource[] = [];
  const rects: number[][] = [];
  const ctx = new Proxy(
    {
      drawImage(source: CanvasImageSource, ...rect: number[]) {
        sources.push(source);
        rects.push(rect);
      },
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop as keyof typeof target];
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, sources, rects };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
