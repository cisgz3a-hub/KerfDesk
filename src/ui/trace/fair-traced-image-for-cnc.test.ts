import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  transformedBBox,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { positionTraceOverRasterSource } from '../state/trace-placement';
import { fairTracedImageForCnc } from './fair-traced-image-for-cnc';

describe('fairTracedImageForCnc', () => {
  it('replaces stale extrema without shifting the source grid or affine placement', () => {
    const source: RasterImage = {
      kind: 'raster-image',
      id: 'source',
      source: 'test.png',
      dataUrl: '',
      pixelWidth: 128,
      pixelHeight: 128,
      color: '#000000',
      dither: 'floyd-steinberg',
      linesPerMm: 10,
      bounds: { minX: 2, minY: 3, maxX: 27.6, maxY: 15.8 },
      transform: {
        ...IDENTITY_TRANSFORM,
        x: 30,
        y: 20,
        scaleX: 1.2,
        scaleY: 0.8,
        rotationDeg: 17,
        mirrorX: true,
      },
    };
    const points = Array.from({ length: 41 }, (_, x) => ({ x, y: x === 20 ? 0.4 : 0 }));
    const traced: TracedImage = {
      kind: 'traced-image',
      id: 'trace',
      source: 'test.png',
      traceSourceId: 'source',
      tracePixelWidth: 128,
      tracePixelHeight: 128,
      transform: IDENTITY_TRANSFORM,
      bounds: { minX: 0, minY: 0, maxX: 40, maxY: 0.4 },
      paths: [{ color: '#000000', polylines: [{ closed: false, points }] }],
    };
    const placement = positionTraceOverRasterSource(source, traced).transform;
    const fixed = fairTracedImageForCnc(traced, placement);
    const conditioned = fixed.paths.flatMap((p) => p.polylines.flatMap((line) => line.points));
    expect(fixed.bounds).toEqual({
      minX: Math.min(...conditioned.map((p) => p.x)),
      maxX: Math.max(...conditioned.map((p) => p.x)),
      minY: Math.min(...conditioned.map((p) => p.y)),
      maxY: Math.max(...conditioned.map((p) => p.y)),
    });
    expect(fixed.bounds.maxY).toBeLessThan(traced.bounds.maxY);
    const positioned = positionTraceOverRasterSource(source, fixed);
    expect(positioned.transform).toEqual(placement);
    expect(positioned.tracePixelWidth).toBe(128);
    expect(positioned.tracePixelHeight).toBe(128);
    expect(positioned.traceSourceId).toBe(source.id);
    expect(conditioned.map((p) => applyTransform(p, placement))).toEqual(
      conditioned.map((p) => applyTransform(p, positioned.transform)),
    );
    expect(transformedBBox(positioned)).not.toEqual(
      transformedBBox({ ...positioned, bounds: traced.bounds }),
    );
    expect(traced.bounds.maxY).toBe(0.4);
  });
});
