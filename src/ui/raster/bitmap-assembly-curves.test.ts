import { describe, expect, it } from 'vitest';
import type { VectorRaster } from '../../core/raster';
import {
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
  type Polyline,
} from '../../core/scene';
import { assembleBitmap, assembleBitmapAsync } from './bitmap-assembly';
import { lumaToBase64 } from './luma-bitmap';

const SQUARE: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
};

function canonicalSquare(polylines: ReadonlyArray<Polyline>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'canonical-square',
    source: 'square.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['fill-operation'],
    paths: [
      {
        color: '#ff0000',
        polylines,
        curves: [
          {
            start: { x: 0, y: 0 },
            segments: SQUARE.points.slice(1).map((to) => ({ kind: 'line' as const, to })),
            closed: true,
          },
        ],
      },
    ],
  };
}

function encode(raster: VectorRaster) {
  return { dataUrl: 'data:image/png;base64,test', lumaBase64: lumaToBase64(raster.luma) };
}

function pixelsOf(source: ImportedSvg, dpi = 254): VectorRaster {
  let pixels: VectorRaster | undefined;
  assembleBitmap(
    [source],
    (raster) => {
      pixels = raster;
      return encode(raster);
    },
    'bitmap',
    { dpi },
  );
  if (pixels === undefined) throw new Error('expected raster');
  return pixels;
}

describe('Convert to Bitmap canonical curve authority', () => {
  it.each([
    ['missing', []],
    [
      'stale',
      [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ],
        },
      ],
    ],
  ] as const)(
    'renders canonical geometry with a %s compatibility cache in both assemblers',
    async (_, cache) => {
      const source = canonicalSquare(cache);
      const before = structuredClone(source);
      const options = {
        dpi: 254,
        renderType: 'use-cut-settings' as const,
        layers: [{ id: 'fill-operation', color: '#000000', mode: 'fill' as const }],
        brightnessPercent: 80,
      };
      const inline = assembleBitmap([source], encode, 'bitmap', options);
      const asyncResult = await assembleBitmapAsync(
        [source],
        async (raster) => encode(raster),
        'bitmap',
        options,
      );
      expect(asyncResult).toEqual(inline);
      expect(inline.pixelWidth).toBe(100);
      expect(inline.pixelHeight).toBe(100);
      expect(
        new Set(
          atob(inline.lumaBase64 ?? '')
            .split('')
            .map((value) => value.charCodeAt(0)),
        ),
      ).toEqual(new Set([204]));
      expect(source).toEqual(before);
    },
  );

  it('keeps legacy polylines when canonical curves are absent', () => {
    const source = canonicalSquare([]);
    const legacy = { ...source, paths: [{ color: '#000000', polylines: [SQUARE] }] };
    const expected = pixelsOf(source).luma;
    expect(pixelsOf(legacy).luma.every((value, index) => value === expected[index])).toBe(true);
  });

  it('honors an explicitly empty canonical path instead of stale ink', () => {
    const source = canonicalSquare([SQUARE]);
    const empty = { ...source, paths: source.paths.map((path) => ({ ...path, curves: [] })) };
    expect(new Set(pixelsOf(empty).luma)).toEqual(new Set([255]));
  });

  it('fills the true cubic arch rather than its rectangular compatibility cache', () => {
    const source = canonicalSquare([SQUARE]);
    const arch: ColoredPath = {
      color: '#000000',
      polylines: [SQUARE],
      curves: [
        {
          start: { x: 0, y: 0 },
          segments: [
            {
              kind: 'cubic',
              control1: { x: 0, y: 10 },
              control2: { x: 10, y: 10 },
              to: { x: 10, y: 0 },
            },
          ],
          closed: true,
        },
      ],
    };
    const raster = pixelsOf({ ...source, paths: [arch] });
    expect(raster.luma[50 * raster.width + 50]).toBe(127);
    expect(raster.luma[70 * raster.width + 10]).toBe(255);
    expect(raster.luma[70 * raster.width + 90]).toBe(255);
  });

  it.each([127, 635])(
    'resolves enlarged, rotated elliptical arcs to subpixel accuracy at %i DPI',
    (dpi) => {
      const source = canonicalSquare([]);
      const ellipse: ImportedSvg = {
        ...source,
        bounds: { minX: -0.01, minY: -0.01, maxX: 0.01, maxY: 0.01 },
        transform: {
          ...IDENTITY_TRANSFORM,
          scaleX: -800,
          scaleY: 300,
          mirrorY: true,
          rotationDeg: 30,
          x: 12,
          y: 20,
        },
        paths: [
          {
            color: '#000000',
            polylines: [],
            curves: [
              {
                start: { x: 0.01, y: 0 },
                closed: true,
                segments: [
                  {
                    kind: 'elliptical-arc',
                    radiusX: 0.01,
                    radiusY: 0.01,
                    rotationDeg: 0,
                    largeArc: false,
                    sweep: true,
                    to: { x: -0.01, y: 0 },
                  },
                  {
                    kind: 'elliptical-arc',
                    radiusX: 0.01,
                    radiusY: 0.01,
                    rotationDeg: 0,
                    largeArc: false,
                    sweep: true,
                    to: { x: 0.01, y: 0 },
                  },
                ],
              },
            ],
          },
        ],
      };
      const result = assembleBitmap([ellipse], encode, 'ellipse', { dpi });
      const bounds = result.bounds;
      const raster = pixelsOf(ellipse, dpi);
      const pixelWidthMm = (bounds.maxX - bounds.minX) / raster.width;
      const pixelHeightMm = (bounds.maxY - bounds.minY) / raster.height;
      let checked = 0;
      let mismatches = 0;
      for (let y = 0; y < raster.height; y += 1) {
        for (let x = 0; x < raster.width; x += 1) {
          const dx = bounds.minX + (x + 0.5) * pixelWidthMm - 12;
          const dy = bounds.minY + (y + 0.5) * pixelHeightMm - 20;
          const localX = (dx * Math.cos(Math.PI / 6) + dy * Math.sin(Math.PI / 6)) / 8;
          const localY = (-dx * Math.sin(Math.PI / 6) + dy * Math.cos(Math.PI / 6)) / 3;
          const radius = Math.hypot(localX, localY);
          // The ellipse's 3 mm minor radius bounds distance from its boundary.
          // Exclude only centers within 0.3 pixel of that analytic boundary.
          if (Math.abs(radius - 1) * 3 <= 0.3 * Math.max(pixelWidthMm, pixelHeightMm)) continue;
          checked += 1;
          if ((raster.luma[y * raster.width + x] !== 255) !== radius < 1) mismatches += 1;
        }
      }
      expect(checked).toBeGreaterThan(raster.width * raster.height * 0.9);
      expect(mismatches).toBe(0);
    },
  );

  it('does not replace a large canonical path with an empty compatibility cache', () => {
    const source = canonicalSquare([]);
    const segments = Array.from({ length: 200_001 }, (_, index) => ({
      kind: 'line' as const,
      to: { x: (index + 1) / 200_001, y: 0 },
    }));
    const large: ImportedSvg = {
      ...source,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      paths: [
        {
          color: '#000000',
          polylines: [],
          curves: [
            {
              start: { x: 0, y: 0 },
              closed: true,
              segments: [
                ...segments,
                { kind: 'line', to: { x: 1, y: 1 } },
                { kind: 'line', to: { x: 0, y: 1 } },
              ],
            },
          ],
        },
      ],
    };
    expect(new Set(pixelsOf(large, 127).luma)).toEqual(new Set([127]));
  });
});
