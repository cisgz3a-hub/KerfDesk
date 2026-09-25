import { afterEach, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type ColoredPath } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { drawRasterImage } from './draw-raster';
import { gray, previewProject, previewRaster, previewSink } from './raster-preview.test-support';

const clip: readonly ColoredPath[] = [
  {
    color: '#000000',
    polylines: [
      {
        closed: true,
        points: [
          { x: 1, y: 0 },
          { x: 3, y: 0 },
          { x: 3, y: 4 },
          { x: 1, y: 4 },
        ],
      },
      {
        closed: true,
        points: [
          { x: 1.25, y: 1 },
          { x: 1.75, y: 1 },
          { x: 1.75, y: 2 },
          { x: 1.25, y: 2 },
        ],
      },
    ],
  },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('clips the ordinary bitmap with one even-odd local path after image placement', () => {
  class LoadedImage {
    complete = true;
    naturalWidth = 8;
    naturalHeight = 4;
    src = '';
  }
  vi.stubGlobal('Image', LoadedImage);
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_target, key) =>
        (...args: unknown[]) => {
          calls.push({ name: String(key), args });
        },
    },
  ) as CanvasRenderingContext2D;
  const transform = {
    ...IDENTITY_TRANSFORM,
    x: -12,
    y: 29,
    rotationDeg: 90,
    mirrorX: true,
    scaleX: 2,
    scaleY: 3,
  };
  drawRasterImage(
    ctx,
    { ...previewRaster('owned-display'), transform, imageClip: clip },
    { scale: 2, offsetX: 4, offsetY: 6 },
  );
  expect(calls.map((call) => call.name)).toEqual([
    'save',
    'translate',
    'rotate',
    'scale',
    'beginPath',
    'moveTo',
    'lineTo',
    'lineTo',
    'lineTo',
    'closePath',
    'moveTo',
    'lineTo',
    'lineTo',
    'lineTo',
    'closePath',
    'clip',
    'drawImage',
    'restore',
  ]);
  expect(calls.find((call) => call.name === 'translate')?.args).toEqual([-20, 64]);
  expect(calls.find((call) => call.name === 'scale')?.args).toEqual([-4, 6]);
  expect(calls.filter((call) => call.name === 'moveTo').map((call) => call.args)).toEqual([
    [1, 0],
    [1.25, 1],
  ]);
  expect(calls.find((call) => call.name === 'clip')?.args).toEqual(['evenodd']);
});

it('rebuilds a cached burn preview when only the owned clip changes or is removed', () => {
  const sink = previewSink(),
    image = {
      ...previewRaster('owned-preview'),
      lumaBase64: btoa(String.fromCharCode(...new Uint8Array(32))),
    };
  sink.draw(previewProject([image]));
  const original = gray(sink.drawn[0]!);
  sink.draw(previewProject([{ ...image, imageClip: clip }]));
  const clipped = gray(sink.drawn[1]!);
  expect(clipped[0]).toBe(255);
  expect(clipped[1]).toBeLessThan(255);
  expect(clipped[2]).toBeLessThan(255);
  expect(clipped[0]).not.toBe(original[0]);
  sink.draw(previewProject([{ ...image, imageClip: [] }]));
  expect(gray(sink.drawn[2]!)).toEqual(new Array(32).fill(255));
  sink.draw(previewProject([image]));
  expect(gray(sink.drawn[3]!)).toEqual(original);
  expect(sink.built).toHaveLength(4);
});

it('cancels an in-flight preview whose owned clip was replaced', () => {
  const sink = previewSink(),
    image = previewRaster('owned-preview-pending');
  const cancelled = vi.fn(),
    schedule = vi.fn(() => cancelled);
  sink.draw(previewProject([{ ...image, imageClip: clip }]), schedule);
  sink.draw(previewProject([{ ...image, imageClip: [] }]), schedule);
  expect(cancelled).toHaveBeenCalledOnce();
  expect(schedule).toHaveBeenCalledTimes(2);
  sink.draw(previewProject([]), schedule);
});

it('rebuilds the clip intersection when the image moves across a fixed external mask', () => {
  const sink = previewSink();
  const image = {
    ...previewRaster('owned-and-external'),
    imageClip: clip,
    imageMaskId: 'external',
    lumaBase64: btoa(String.fromCharCode(...new Uint8Array(32))),
  };
  const mask = {
    ...createRectangle({
      id: 'external',
      color: clip[0]!.color,
      spec: { widthMm: 1, heightMm: 4, cornerRadiusMm: 0 },
    }),
    transform: { ...IDENTITY_TRANSFORM, x: 1 },
  };
  sink.draw(previewProject([image, mask]));
  expect(gray(sink.drawn[0]!)[1]).toBeLessThan(255);
  sink.draw(previewProject([{ ...image, transform: { ...image.transform, x: 1 } }, mask]));
  expect(gray(sink.drawn[1]!)).toEqual(new Array(32).fill(255));
  expect(sink.built).toHaveLength(2);
});
