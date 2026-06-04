// ADR-029 §4 Convert to Bitmap — the UI builder's DOM-free half. assembleBitmap
// takes the canvas encode step as a parameter, so the gather → rasterize →
// field-assembly logic (incl. the DPI wiring and the bounds/transform copy that
// keeps the bitmap registered over the vector it replaces) is unit-testable
// without a real canvas. buildBitmapFromVector — the production wiring with the
// real lumaToBitmap — is verified in-browser (A2-v), not here.

import { describe, expect, it, vi } from 'vitest';
import type { VectorRaster } from '../../core/raster';
import { evaluateRasterBudget } from '../../core/raster/raster-budget';
import {
  DEFAULT_RASTER_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Bounds,
  type ColoredPath,
  type ImportedSvg,
  type RasterImage,
  type TextObject,
  type TracedImage,
  type Transform,
} from '../../core/scene';
import type { BitmapFields } from './luma-bitmap';
import { assembleBitmap, isConvertibleVector } from './vector-to-bitmap';

const BOUNDS_20MM: Bounds = { minX: 0, minY: 0, maxX: 20, maxY: 20 };

// Deliberately non-identity so the verbatim-copy assertion can't pass by accident.
const TRANSFORM: Transform = {
  x: 5,
  y: 7,
  scaleX: 2,
  scaleY: 3,
  rotationDeg: 45,
  mirrorX: true,
  mirrorY: false,
};

const SQUARE: ColoredPath = {
  color: '#000000',
  polylines: [
    {
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      closed: true,
    },
  ],
};

function makeSvg(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'svg-1',
    source: 'logo.svg',
    bounds: BOUNDS_20MM,
    transform: TRANSFORM,
    paths: [SQUARE],
  };
}

function makeOpenSvg(): ImportedSvg {
  return {
    ...makeSvg(),
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 10 },
              { x: 20, y: 10 },
            ],
          },
        ],
      },
    ],
  };
}

function makeMixedSvg(): ImportedSvg {
  return {
    ...makeSvg(),
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 1, y: 10 },
              { x: 19, y: 10 },
            ],
          },
        ],
      },
      {
        color: '#0000ff',
        polylines: [
          {
            closed: true,
            points: [
              { x: 2, y: 2 },
              { x: 8, y: 2 },
              { x: 8, y: 8 },
              { x: 2, y: 8 },
            ],
          },
        ],
      },
    ],
  };
}

function makeHugeSvg(): ImportedSvg {
  return {
    ...makeSvg(),
    bounds: { minX: 0, minY: 0, maxX: 778.2, maxY: 505 },
    transform: IDENTITY_TRANSFORM,
  };
}

function makeHugeFittedSvg(): ImportedSvg {
  return {
    ...makeHugeSvg(),
    transform: { ...IDENTITY_TRANSFORM, scaleX: 0.25, scaleY: 0.25 },
  };
}

function makeText(): TextObject {
  return {
    kind: 'text',
    id: 'text-1',
    content: 'Hi',
    fontKey: 'sans',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1,
    letterSpacing: 0,
    color: '#000000',
    bounds: BOUNDS_20MM,
    transform: TRANSFORM,
    paths: [SQUARE],
  };
}

function makeTraced(): TracedImage {
  return {
    kind: 'traced-image',
    id: 'traced-1',
    source: 'photo.png',
    bounds: BOUNDS_20MM,
    transform: TRANSFORM,
    paths: [SQUARE],
  };
}

function makeRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'raster-1',
    source: 'img.png',
    dataUrl: 'data:,',
    pixelWidth: 10,
    pixelHeight: 10,
    bounds: BOUNDS_20MM,
    transform: TRANSFORM,
    color: DEFAULT_RASTER_LAYER_COLOR,
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

// Stand-in for lumaToBitmap: echoes the raster it received into the returned
// fields so a test can prove the rasterize → encode handoff (dimensions + luma
// length) without a canvas.
function fakeEncode(raster: VectorRaster): BitmapFields {
  return {
    dataUrl: `data:fake/${raster.width}x${raster.height}`,
    lumaBase64: `luma:${raster.luma.length}`,
  };
}

function inkCount(raster: VectorRaster): number {
  return [...raster.luma].filter((v) => v === 128).length;
}

describe('isConvertibleVector', () => {
  it('accepts the three vector-carrying kinds', () => {
    expect(isConvertibleVector(makeSvg())).toBe(true);
    expect(isConvertibleVector(makeText())).toBe(true);
    expect(isConvertibleVector(makeTraced())).toBe(true);
  });

  it('rejects a raster-image (already a bitmap)', () => {
    expect(isConvertibleVector(makeRaster())).toBe(false);
  });
});

describe('assembleBitmap', () => {
  it('sizes the bitmap from displayed bounds x lines/mm', () => {
    const result = assembleBitmap(makeSvg(), fakeEncode, 'new-id');
    expect(result.pixelWidth).toBe(400);
    expect(result.pixelHeight).toBe(600);
  });

  it('rasterizes then carries the encoder output verbatim', () => {
    const result = assembleBitmap(makeSvg(), fakeEncode, 'new-id');
    // The echoed fields prove encode saw the physical-size pixel grid.
    expect(result.dataUrl).toBe('data:fake/400x600');
    expect(result.lumaBase64).toBe('luma:240000');
  });

  it('copies the source bounds + transform verbatim (overlay registration)', () => {
    const source = makeSvg();
    const result = assembleBitmap(source, fakeEncode, 'new-id');
    expect(result.bounds).toEqual(source.bounds);
    expect(result.transform).toEqual(source.transform);
  });

  it('uses the injected id and the image-import raster defaults', () => {
    const result = assembleBitmap(makeSvg(), fakeEncode, 'new-id');
    expect(result.id).toBe('new-id');
    expect(result.kind).toBe('raster-image');
    expect(result.color).toBe(DEFAULT_RASTER_LAYER_COLOR);
    expect(result.dither).toBe('floyd-steinberg');
    expect(result.linesPerMm).toBe(10);
  });

  it('uses explicit DPI to set the converted bitmap density', () => {
    const result = assembleBitmap(makeSvg(), fakeEncode, 'new-id', {
      dpi: 127,
      renderType: 'fill-all',
    });
    expect(result.pixelWidth).toBe(200);
    expect(result.pixelHeight).toBe(300);
    expect(result.linesPerMm).toBe(5);
  });

  it('passes Outlines through so open vector strokes survive conversion', () => {
    let encoded: VectorRaster | null = null;
    const result = assembleBitmap(
      makeOpenSvg(),
      (raster) => {
        encoded = raster;
        return fakeEncode(raster);
      },
      'new-id',
      { dpi: 25.4, renderType: 'outlines' },
    );

    expect(result.pixelWidth).toBe(40);
    expect(result.pixelHeight).toBe(60);
    expect(encoded).not.toBeNull();
    expect(encoded === null ? 0 : inkCount(encoded)).toBeGreaterThan(0);
  });

  it('Use Cut Settings renders a line-mode path as an outline', () => {
    let encoded: VectorRaster | null = null;
    assembleBitmap(
      makeOpenSvg(),
      (raster) => {
        encoded = raster;
        return fakeEncode(raster);
      },
      'new-id',
      {
        dpi: 25.4,
        renderType: 'use-cut-settings',
        layers: [{ color: '#ff0000', mode: 'line' }],
      },
    );

    expect(encoded).not.toBeNull();
    expect(encoded === null ? 0 : inkCount(encoded)).toBeGreaterThan(0);
  });

  it('Use Cut Settings fills a fill-mode closed path', () => {
    let encoded: VectorRaster | null = null;
    assembleBitmap(
      makeMixedSvg(),
      (raster) => {
        encoded = raster;
        return fakeEncode(raster);
      },
      'new-id',
      {
        dpi: 25.4,
        renderType: 'use-cut-settings',
        layers: [
          { color: '#ff0000', mode: 'line' },
          { color: '#0000ff', mode: 'fill' },
        ],
      },
    );

    expect(encoded).not.toBeNull();
    expect(encoded === null ? 0 : inkCount(encoded)).toBeGreaterThan(36);
  });

  it('labels SVG / traced bitmaps from `source` and text from `content`', () => {
    expect(assembleBitmap(makeSvg(), fakeEncode, 'i').source).toBe('logo.svg (bitmap)');
    expect(assembleBitmap(makeTraced(), fakeEncode, 'i').source).toBe('photo.png (bitmap)');
    expect(assembleBitmap(makeText(), fakeEncode, 'i').source).toBe('Hi (bitmap)');
  });

  it('uses the transformed display size so a fitted large vector can convert', () => {
    const encode = vi.fn(fakeEncode);
    const result = assembleBitmap(makeHugeFittedSvg(), encode, 'new-id');

    expect(result.pixelWidth).toBe(1946);
    expect(result.pixelHeight).toBe(1263);
    expect(result.linesPerMm).toBe(10);
    expect(evaluateRasterBudget(result.pixelWidth, result.pixelHeight).kind).toBe('ok');
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it('reduces lines/mm instead of rejecting physically oversized conversions', () => {
    const encode = vi.fn(fakeEncode);
    const result = assembleBitmap(makeHugeSvg(), encode, 'new-id');

    expect(result.pixelWidth).toBeLessThan(7782);
    expect(result.pixelHeight).toBeLessThan(5050);
    expect(result.linesPerMm).toBeLessThan(10);
    expect(evaluateRasterBudget(result.pixelWidth, result.pixelHeight).kind).toBe('ok');
    expect(encode).toHaveBeenCalledTimes(1);
  });
});
