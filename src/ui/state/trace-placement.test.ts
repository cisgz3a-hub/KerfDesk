import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { positionTraceOverRasterSource } from './trace-placement';

function sourceRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'source-photo',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,AAAA',
    pixelWidth: 6000,
    pixelHeight: 4000,
    bounds: { minX: 10, minY: 20, maxX: 130, maxY: 100 },
    transform: {
      ...IDENTITY_TRANSFORM,
      x: 33,
      y: 77,
      scaleX: 1.5,
      scaleY: 0.75,
      rotationDeg: 30,
      mirrorX: true,
    },
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

function trace(): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace',
    source: 'photo.png',
    tracePixelWidth: 2048,
    tracePixelHeight: 1365,
    bounds: { minX: 100, minY: 200, maxX: 1900, maxY: 1200 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [] }],
  };
}

describe('positionTraceOverRasterSource', () => {
  it('maps a downsampled trace grid across the full imported photo', () => {
    const source = sourceRaster();
    const positioned = positionTraceOverRasterSource(source, trace());

    expect(applyTransform({ x: 0, y: 0 }, positioned.transform)).toEqual(
      applyTransform({ x: source.bounds.minX, y: source.bounds.minY }, source.transform),
    );
    const traceFarCorner = applyTransform(
      { x: trace().tracePixelWidth ?? 0, y: trace().tracePixelHeight ?? 0 },
      positioned.transform,
    );
    const sourceFarCorner = applyTransform(
      { x: source.bounds.maxX, y: source.bounds.maxY },
      source.transform,
    );
    expect(traceFarCorner.x).toBeCloseTo(sourceFarCorner.x, 10);
    expect(traceFarCorner.y).toBeCloseTo(sourceFarCorner.y, 10);
    expect(positioned.traceSourceId).toBe(source.id);
  });

  it('uses the source pixel grid for legacy traces without grid metadata', () => {
    const source = sourceRaster();
    const {
      tracePixelWidth: _tracePixelWidth,
      tracePixelHeight: _tracePixelHeight,
      ...legacy
    } = trace();
    const positioned = positionTraceOverRasterSource(source, legacy);
    const traceFarCorner = applyTransform(
      { x: source.pixelWidth, y: source.pixelHeight },
      positioned.transform,
    );
    const sourceFarCorner = applyTransform(
      { x: source.bounds.maxX, y: source.bounds.maxY },
      source.transform,
    );

    expect(traceFarCorner.x).toBeCloseTo(sourceFarCorner.x, 10);
    expect(traceFarCorner.y).toBeCloseTo(sourceFarCorner.y, 10);
  });
});
