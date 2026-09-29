// Regression tests for ADR-359 Amendment 1: a picture scaled on the design
// canvas is drawn from a halved copy within 2x of its size on screen. Chromium
// rescales (or, for an <img>, re-decodes) a drawImage source synchronously on
// the main thread whenever a draw needs a smaller power-of-two level of it, and
// zooming crossed one of those levels every few notches: 160-670 ms stalls
// with a 24 MP photo. A draw between half and full size never needs one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_DISPLAY_LEVEL_EDGE_PX,
  displayLevel,
  releaseDisplayLevels,
} from './raster-display-levels';

type Blit = {
  readonly target: HTMLCanvasElement;
  readonly from: CanvasImageSource;
  readonly args: readonly number[];
  readonly smoothing: boolean;
  readonly quality: ImageSmoothingQuality;
};

let blits: Blit[] = [];
let contextOptions: unknown[] = [];

beforeEach(() => {
  blits = [];
  contextOptions = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    _type: string,
    options?: unknown,
  ) {
    contextOptions.push(options);
    const ctx = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'high' as ImageSmoothingQuality,
      drawImage: (from: CanvasImageSource, ...args: number[]) => {
        blits.push({
          target: this,
          from,
          args,
          smoothing: ctx.imageSmoothingEnabled,
          quality: ctx.imageSmoothingQuality,
        });
      },
    };
    return ctx as unknown as CanvasRenderingContext2D;
  } as HTMLCanvasElement['getContext']);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('displayLevel', () => {
  it('draws a source shown at more than half its size as it is', () => {
    const source = canvasOf(4000, 3000);

    expect(displayLevel(source, 2001, 1501)).toBe(source);
    expect(displayLevel(source, 9000, 6750)).toBe(source);
    expect(blits).toHaveLength(0);
  });

  it('keeps every draw between half and full size of the copy it reads while zooming', () => {
    const source = canvasOf(4000, 3000);
    for (let width = 12; width < 12_000; width *= 1.1) {
      const height = width * 0.75;
      const drawn = displayLevel(source, width, height) as HTMLCanvasElement;
      if (drawn === source) {
        expect(width).toBeGreaterThan(source.width / 2);
        continue;
      }
      expect(drawn.width).toBeGreaterThanOrEqual(width);
      expect(drawn.height).toBeGreaterThanOrEqual(height);
      const isSmallest = Math.min(drawn.width, drawn.height) < 2 * MIN_DISPLAY_LEVEL_EDGE_PX;
      if (!isSmallest) expect(width / drawn.width).toBeGreaterThan(0.5);
    }
  });

  it('builds each halved copy once, as a box-filtered blit of the one above', () => {
    const source = canvasOf(4000, 3000);
    const zoomSweep = [500, 900, 1800, 3000, 1800, 900, 500, 240, 500, 3000];
    for (const width of zoomSweep) displayLevel(source, width, width * 0.75);

    expect(blits.map((blit) => [blit.target.width, blit.target.height])).toEqual([
      [2000, 1500],
      [1000, 750],
      [500, 375],
      [250, 188],
    ]);
    expect(blits[0]?.from).toBe(source);
    for (let index = 1; index < blits.length; index += 1) {
      expect(blits[index]?.from).toBe(blits[index - 1]?.target);
    }
    for (const blit of blits) {
      expect(blit.args).toEqual([0, 0, blit.target.width, blit.target.height]);
      expect(blit.smoothing).toBe(true);
      expect(blit.quality).toBe('low');
    }
    // CPU canvases, so building a copy never uploads the larger one.
    expect(contextOptions).toEqual(blits.map(() => ({ willReadFrequently: true })));
  });

  it('leaves a lazily decoded <img> and a degenerate draw alone', () => {
    const img = new Image();
    const source = canvasOf(4000, 3000);

    expect(displayLevel(img, 10, 10)).toBe(img);
    expect(displayLevel(source, 0, 0)).toBe(source);
    expect(displayLevel(source, Number.NaN, 10)).toBe(source);
    expect(blits).toHaveLength(0);
  });

  it('frees the copies of a released source and rebuilds them on demand', () => {
    const source = canvasOf(4000, 3000);
    const level = displayLevel(source, 900, 675) as HTMLCanvasElement;
    expect(level.width).toBe(1000);

    releaseDisplayLevels(source);

    expect(level.width).toBe(0);
    expect(level.height).toBe(0);
    const rebuilt = displayLevel(source, 900, 675);
    expect(rebuilt).not.toBe(level);
    expect(blits).toHaveLength(4);
  });
});

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
