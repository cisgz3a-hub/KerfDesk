// ADR-029 §4 Convert to Bitmap — the UI builder's DOM-free half. assembleBitmap
// takes the canvas encode step as a parameter, so the gather → rasterize →
// field-assembly logic (incl. the DPI wiring and the bounds/transform copy that
// keeps the bitmap registered over the vector it replaces) is unit-testable
// without a real canvas. buildBitmapFromVector — the production wiring with the
// real lumaToBitmap — is verified in-browser (A2-v), not here.

import { describe, expect, it, vi } from 'vitest';
import type { VectorRaster } from '../../core/raster';
import {
  DEFAULT_RASTER_LAYER_COLOR,
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

function makeHugeSvg(): ImportedSvg {
  return {
    ...makeSvg(),
    bounds: { minX: 0, minY: 0, maxX: 200.1, maxY: 200.1 },
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
  it('sizes the bitmap from bounds × DPI (20mm @ 254dpi → 200px)', () => {
    const result = assembleBitmap(makeSvg(), fakeEncode, 'new-id');
    expect(result.pixelWidth).toBe(200);
    expect(result.pixelHeight).toBe(200);
  });

  it('rasterizes then carries the encoder output verbatim', () => {
    const result = assembleBitmap(makeSvg(), fakeEncode, 'new-id');
    // The echoed fields prove encode saw the 200×200 / 40000-luma grid.
    expect(result.dataUrl).toBe('data:fake/200x200');
    expect(result.lumaBase64).toBe('luma:40000');
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

  it('labels SVG / traced bitmaps from `source` and text from `content`', () => {
    expect(assembleBitmap(makeSvg(), fakeEncode, 'i').source).toBe('logo.svg (bitmap)');
    expect(assembleBitmap(makeTraced(), fakeEncode, 'i').source).toBe('photo.png (bitmap)');
    expect(assembleBitmap(makeText(), fakeEncode, 'i').source).toBe('Hi (bitmap)');
  });

  it('refuses over-budget conversions before encoding a bitmap', () => {
    const encode = vi.fn(fakeEncode);

    expect(() => assembleBitmap(makeHugeSvg(), encode, 'new-id')).toThrow(
      /bitmap would be 2001x2001 px/i,
    );
    expect(encode).not.toHaveBeenCalled();
  });
});
