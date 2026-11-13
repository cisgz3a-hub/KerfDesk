import { afterEach, expect, it, vi } from 'vitest';
import { bakedImageMaskClip } from '../../core/raster/image-mask-clip';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { createEllipse } from '../../core/shapes/primitives';
import { drawScene } from './draw-scene';

// Tools audit T1, T16-P2-2 (ADR-480 Amendment 6): after Apply Mask the design
// canvas drew the whole photo, while a baked (Crop/Flatten) clip was drawn
// clipped (Amendment 1 D3). The live mask now clips the bitmap the same way.

afterEach(() => {
  vi.unstubAllGlobals();
});

class ReadyImage {
  complete = true;
  naturalWidth = 80;
  naturalHeight = 60;
  width = 80;
  height = 60;
  src = '';
  onload: unknown = null;
  onerror: unknown = null;
  decoding = 'async';
  addEventListener = (): void => undefined;
  removeEventListener = (): void => undefined;
  decode(): Promise<void> {
    return Promise.resolve();
  }
}

type Recorded = { readonly op: string; readonly clipDepth: number; readonly args: unknown[] };

function recorder(): { ctx: CanvasRenderingContext2D; log: Recorded[] } {
  const log: Recorded[] = [];
  const stack: number[] = [];
  let clipDepth = 0;
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get: (_target, key) => {
      if (typeof key !== 'string' || key === 'then') return undefined;
      if (key in target) return target[key];
      if (key === 'canvas') return { width: 800, height: 600 };
      if (key === 'measureText') return () => ({ width: 10 });
      if (key === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (key === 'getLineDash') return () => [];
      if (key.startsWith('create'))
        return () => ({ addColorStop: () => undefined, setTransform: () => undefined });
      return (...args: unknown[]) => {
        if (key === 'save') stack.push(clipDepth);
        if (key === 'restore') clipDepth = stack.pop() ?? 0;
        if (key === 'clip') clipDepth += 1;
        log.push({ op: key, clipDepth, args });
      };
    },
    set: (_target, key, value) => {
      target[key as string] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

const PHOTO: RasterImage = {
  kind: 'raster-image',
  id: 'PHOTO',
  source: 'p.png',
  dataUrl: 'data:image/png;base64,live-mask-photo',
  pixelWidth: 80,
  pixelHeight: 60,
  bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
  transform: { ...IDENTITY_TRANSFORM, x: 50, y: 50 },
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 5,
};

const MASK = createEllipse({
  id: 'CIRC',
  color: '#000000',
  spec: { widthMm: 20, heightMm: 20 },
  transform: { ...IDENTITY_TRANSFORM, x: 60, y: 55 },
});

function project(image: RasterImage): Project {
  return {
    ...createProject(),
    scene: {
      objects: [image, MASK],
      layers: [
        createLayer({ id: 'img', color: '#808080', mode: 'image' }),
        createLayer({ id: 'line', color: '#000000', mode: 'line' }),
      ],
    },
  };
}

function photoDraws(image: RasterImage): Recorded[] {
  const { ctx, log } = recorder();
  drawScene(ctx, 800, 600, project(image), { selectedId: null, preview: false });
  return log.filter((entry) => entry.op === 'drawImage');
}

it('clips a photo to its live mask on the design canvas, as it does a baked one', () => {
  vi.stubGlobal('Image', ReadyImage);
  const live = { ...PHOTO, imageMaskId: 'CIRC' };
  const clip = bakedImageMaskClip(live, MASK);
  if (clip === null) throw new Error('Expected a baked clip.');
  const { imageMaskId: _mask, ...unmasked } = live;

  // Main: the live-masked photo drew at clip depth 0, the whole bitmap.
  expect(photoDraws(live).map((entry) => entry.clipDepth)).toEqual([1]);
  expect(photoDraws({ ...unmasked, imageClip: clip }).map((entry) => entry.clipDepth)).toEqual([1]);
  expect(photoDraws(PHOTO).map((entry) => entry.clipDepth)).toEqual([0]);
});

it('clips in screen space along the mask outline, by the even-odd rule', () => {
  vi.stubGlobal('Image', ReadyImage);
  const { ctx, log } = recorder();
  drawScene(ctx, 800, 600, project({ ...PHOTO, imageMaskId: 'CIRC' }), {
    selectedId: null,
    preview: false,
  });
  const clipIndex = log.findIndex((entry) => entry.op === 'clip');
  expect(log[clipIndex]?.args).toEqual(['evenodd']);
  // The clip path is the mask outline, built after the last beginPath.
  const begin = log
    .slice(0, clipIndex)
    .map((entry) => entry.op)
    .lastIndexOf('beginPath');
  const points = log
    .slice(begin, clipIndex)
    .filter((entry) => entry.op === 'moveTo' || entry.op === 'lineTo')
    .map((entry) => entry.args as [number, number]);
  expect(points.length).toBeGreaterThan(16);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  // A 20 mm circle: equal screen width and height, not the 40 x 30 photo.
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  expect(width).toBeGreaterThan(0);
  expect(height / width).toBeCloseTo(1, 2);
});
