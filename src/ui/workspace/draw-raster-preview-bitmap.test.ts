// ADR-359 Amendment 2: the Preview drew its dither bitmap with nearest
// sampling at every zoom, so a shrunk preview skipped burn cells and its
// pattern shimmered at each zoom step.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { rasterScanFrame } from '../../core/raster/raster-scan-frame';
import {
  drawMachineRasterBitmap,
  PREVIEW_NEAREST_MIN_CELL_PX,
  previewSamplesNearest,
} from './draw-raster-preview-bitmap';
import { drawRasterPreview } from './draw-raster-preview';
import { displayLevel, releaseDisplayLevels } from './raster-display-levels';
import { retainPreviewCanvases, storePreviewCanvas } from './raster-preview-cache';
import {
  immediate,
  previewProject,
  previewRaster,
  previewSink,
} from './raster-preview.test-support';

type Draw = { readonly source: unknown; readonly smoothing: boolean };

// Records what each drawImage reads and whether smoothing was on for it;
// save and restore keep the smoothing flag as a real context does.
function recordingContext(draws: Draw[]): CanvasRenderingContext2D {
  const state = { imageSmoothingEnabled: true };
  const saved: boolean[] = [];
  return new Proxy(state, {
    get(target, key) {
      if (key === 'drawImage') {
        return (source: unknown) => draws.push({ source, smoothing: target.imageSmoothingEnabled });
      }
      if (key === 'save') return () => saved.push(target.imageSmoothingEnabled);
      if (key === 'restore') {
        return () => {
          target.imageSmoothingEnabled = saved.pop() ?? target.imageSmoothingEnabled;
        };
      }
      if (key in target) return target[key as keyof typeof target];
      return () => undefined;
    },
    set(target, key, value) {
      if (key === 'imageSmoothingEnabled') target.imageSmoothingEnabled = Boolean(value);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('previewSamplesNearest', () => {
  it('samples nearest only while each bitmap pixel spans two screen pixels each way', () => {
    expect(PREVIEW_NEAREST_MIN_CELL_PX).toBe(2);
    expect(previewSamplesNearest(200, 100, 100, 50)).toBe(true);
    expect(previewSamplesNearest(800, 400, 100, 50)).toBe(true);
    expect(previewSamplesNearest(199, 100, 100, 50)).toBe(false);
    expect(previewSamplesNearest(1000, 90, 100, 50)).toBe(false);
    expect(previewSamplesNearest(100, 50, 100, 50)).toBe(false);
    expect(previewSamplesNearest(25, 12.5, 100, 50)).toBe(false);
  });
});

describe('drawMachineRasterBitmap sampling', () => {
  const device = createProject().device;
  // 400 x 200 bitmap pixels over 200 x 100 mm: one pixel per half millimetre,
  // so a pixel spans scale / 2 screen pixels.
  const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };

  function bitmap(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    return canvas;
  }

  it.each([0, 30])('smooths and reads a halved copy when shrunk (scan angle %i deg)', (angle) => {
    const source = bitmap();
    const frame = rasterScanFrame(angle);
    const at = (scale: number): Draw => {
      const draws: Draw[] = [];
      drawMachineRasterBitmap(recordingContext(draws), source, bounds, frame, device, {
        scale,
        offsetX: 0,
        offsetY: 0,
      });
      expect(draws).toHaveLength(1);
      return draws[0]!;
    };
    // 4 px a cell: crisp dots.
    expect(at(8)).toEqual({ source, smoothing: false });
    // 1.5 px a cell: smoothed, drawn from the bitmap itself (above half size).
    expect(at(3)).toEqual({ source, smoothing: true });
    // 0.2 px a cell (80 x 40 px on screen): smoothed from the 100 x 50 copy.
    const shrunk = at(0.4);
    expect(shrunk.smoothing).toBe(true);
    expect(shrunk.source).not.toBe(source);
    expect(shrunk.source).toMatchObject({ width: 100, height: 50 });
    releaseDisplayLevels(source);
  });
});

describe('preview canvas levels', () => {
  function canvasOf(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  it('frees the halved copies of a preview when its raster is edited or leaves the scene', () => {
    const raster = previewRaster('released-preview');
    const first = canvasOf(400, 200);
    storePreviewCanvas(raster, 'settings', first);
    const firstLevel = displayLevel(first, 80, 40) as HTMLCanvasElement;
    expect(firstLevel.width).toBe(100);
    // An Image Studio Apply keeps the id and replaces the pixels.
    const edited = { ...raster, lumaBase64: `${raster.lumaBase64 ?? ''}AA==` };
    const second = canvasOf(400, 200);
    storePreviewCanvas(edited, 'settings', second);
    expect(firstLevel.width).toBe(0);
    const secondLevel = displayLevel(second, 80, 40) as HTMLCanvasElement;
    retainPreviewCanvases(new Set());
    expect(secondLevel.width).toBe(0);
  });
});

describe('drawRasterPreview sampling', () => {
  it('draws the burn simulation smoothed when zoomed out and nearest when zoomed in', () => {
    previewSink();
    const project = previewProject([previewRaster('sampling-preview')]);
    const draws: Draw[] = [];
    const ctx = recordingContext(draws);
    for (const scale of [0.5, 4]) {
      drawRasterPreview(
        ctx,
        project,
        { scale, offsetX: 0, offsetY: 0 },
        { scheduleBuild: immediate },
      );
    }
    expect(draws.map((draw) => draw.smoothing)).toEqual([true, false]);
    // Either way the draw leaves the workspace context as it found it.
    expect(ctx.imageSmoothingEnabled).toBe(true);
  });
});
