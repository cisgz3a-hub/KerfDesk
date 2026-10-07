import { describe, expect, it } from 'vitest';
import { applyImageMaskToLuma } from '../../core/raster/image-mask';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type RasterImage,
  type ImportedSvg,
} from '../../core/scene';
import { TRACE_PRESETS, boundsFromColoredPaths, type RawImageData } from '../../core/trace';
import { traceImageWithBoundaryMode } from './region-enhance-trace';
import { createTracePreparation } from './trace-preparation';
import {
  applyTraceSourceMask,
  bindTraceSourceMask,
  maskTraceSourceResult,
  traceSourceMaskMatches,
} from './trace-source-mask';

const rectangle = (x: number, y: number, width: number, height: number) => ({
  closed: true,
  points: [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ],
});
const clip: ColoredPath[] = [
  { color: '#000000', polylines: [rectangle(4, 4, 56, 56), rectangle(24, 24, 16, 16)] },
];
const source: RasterImage = {
  kind: 'raster-image',
  id: 'source',
  source: 'fixed.png',
  dataUrl: 'data:image/png;base64,original',
  pixelWidth: 64,
  pixelHeight: 64,
  bounds: { minX: 0, minY: 0, maxX: 64, maxY: 64 },
  transform: IDENTITY_TRANSFORM,
  color: '#000000',
  dither: 'threshold',
  linesPerMm: 1,
  imageClip: clip,
};
function black(width = 64): RawImageData {
  const data = new Uint8ClampedArray(width * width * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height: width, data, rgbCompositedOnWhite: true };
}

describe('trace / engraving mask parity', () => {
  it('keeps an empty owned clip empty even if tone controls would trace paper', () => {
    const image = { ...source, imageClip: [] };
    const file = bindTraceSourceMask(new File(['original'], 'empty-clip.png'), image, undefined);
    const paths = [{ color: '#000000', polylines: [rectangle(0, 0, 64, 64)] }];
    expect(
      maskTraceSourceResult(file, { paths, bounds: source.bounds, width: 64, height: 64 }).paths,
    ).toEqual([]);
    expect(
      applyTraceSourceMask(black(), image).data.every(
        (value, index) => value === (index % 4 === 3 ? 0 : 255),
      ),
    ).toBe(true);
  });
  it.each([16, 32, 64])(
    'shares engraving pixel membership at a %s pixel decode, with transformed external mask and native hole',
    (size) => {
      const image = {
        ...source,
        imageMaskId: 'mask',
        transform: {
          ...IDENTITY_TRANSFORM,
          x: 20,
          y: 40,
          rotationDeg: 30,
          scaleX: 2,
          mirrorY: true,
        },
      };
      const mask: ImportedSvg = {
        kind: 'imported-svg',
        id: 'mask',
        source: 'fixed-mask.svg',
        bounds: source.bounds,
        transform: IDENTITY_TRANSFORM,
        paths: [
          {
            color: '#000000',
            polylines: [
              {
                closed: true,
                points: rectangle(8, 8, 40, 40).points.map((point) =>
                  applyTransform(point, image.transform),
                ),
              },
            ],
          },
        ],
      };
      const pixels = black(size),
        original = pixels.data.slice();
      const masked = applyTraceSourceMask(pixels, image, mask);
      const luma = applyImageMaskToLuma({
        image,
        maskObject: mask,
        width: size,
        height: size,
        luma: new Uint8Array(size * size),
      });
      for (let i = 0; i < luma.length; i += 1) {
        expect(masked.data[i * 4]).toBe(luma[i]);
        expect(masked.data[i * 4 + 3]).toBe(luma[i] === 255 ? 0 : 255);
      }
      expect(pixels.data).toEqual(original);
      expect(image.imageClip).toBe(clip);
      expect(image.dataUrl).toBe(source.dataUrl);
    },
  );

  it('clips closed and open outputs under the same even-odd hole, preserving an untouched curve', () => {
    const file = bindTraceSourceMask(new File(['original'], 'trace.png'), source, undefined);
    const paths = [
      {
        color: '#000000',
        polylines: [
          rectangle(0, 0, 64, 64),
          {
            closed: false,
            points: [
              { x: 0, y: 32 },
              { x: 64, y: 32 },
            ],
          },
        ],
      },
    ];
    const result = maskTraceSourceResult(file, {
      paths,
      bounds: boundsFromColoredPaths(paths),
      width: 64,
      height: 64,
    });
    expect(result.bounds).toEqual({ minX: 4, minY: 4, maxX: 60, maxY: 60 });
    const open = result.paths.flatMap((path) => path.polylines).filter((line) => !line.closed);
    expect(open).toHaveLength(2);
    expect(
      open.flatMap((line) => line.points.map((point) => point.x)).sort((a, b) => a - b),
    ).toEqual([4, 24, 40, 60]);
    const untouched = [
      {
        color: '#000000',
        polylines: [rectangle(8, 8, 8, 8)],
        curves: [
          {
            closed: true,
            start: { x: 8, y: 8 },
            segments: [
              { kind: 'line' as const, to: { x: 16, y: 8 } },
              { kind: 'line' as const, to: { x: 16, y: 16 } },
              { kind: 'line' as const, to: { x: 8, y: 16 } },
            ],
          },
        ],
      },
    ];
    const simple = {
      paths: untouched,
      bounds: boundsFromColoredPaths(untouched),
      width: 64,
      height: 64,
    };
    expect(maskTraceSourceResult(file, simple)).toBe(simple);
    expect(traceSourceMaskMatches(file, source)).toBe(true);
    expect(traceSourceMaskMatches(file, { ...source })).toBe(false);
  });

  it.each(['Line Art', 'Edge Detection', 'Centerline', 'Photo shading'])(
    'keeps %s preview and result inside mask with Invert and crop',
    async (preset) => {
      const white = black();
      white.data.fill(255);
      const pixels = applyTraceSourceMask(white, source);
      const file = bindTraceSourceMask(new File(['original'], 'trace.png'), source, undefined);
      const options = {
        ...TRACE_PRESETS[preset]!,
        invert: true,
        ...(preset === 'Photo shading' ? { photoDetail: 20 } : {}),
      };
      const request = {
        file,
        options,
        boundary: { x: 12, y: 12, width: 40, height: 40 },
        boundaryMode: 'crop' as const,
      };
      const preparation = createTracePreparation(
        request,
        Promise.resolve({ img: pixels, hasTransparency: true }),
        0,
        () => undefined,
      );
      const preview = await preparation.consume();
      const fresh = maskTraceSourceResult(
        file,
        await traceImageWithBoundaryMode(pixels, options, request.boundary, 'crop'),
      );
      expect(preview.paths).toEqual(fresh.paths);
      expect(preview.paths.length).toBeGreaterThan(0);
      expect(preview.width).toBe(64);
      for (const path of preview.paths)
        for (const line of path.polylines)
          for (const point of line.points) {
            expect(point.x).toBeGreaterThanOrEqual(12 - 0.001);
            expect(point.x).toBeLessThanOrEqual(52 + 0.001);
            expect(point.y).toBeGreaterThanOrEqual(12 - 0.001);
            expect(point.y).toBeLessThanOrEqual(52 + 0.001);
            expect(
              point.x > 24.001 && point.x < 39.999 && point.y > 24.001 && point.y < 39.999,
            ).toBe(false);
          }
    },
  );
});
