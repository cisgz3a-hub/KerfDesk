// Decision-logic tests for trace-from-camera. The geometric warp itself is
// proven in core (bed-image); jsdom has no real 2D canvas, so the PNG encoder
// is replaced with one that the tests switch between working and failing.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { overheadPose, wideLens } from '../../core/camera/model/model-fixtures';
import type { RgbaImage } from '../../core/camera/rgba-image';

const encoder = vi.hoisted(() => ({ works: true }));
vi.mock('./png-encode', () => ({
  rgbaToPngDataUrl: () => (encoder.works ? 'data:image/png;base64,AAA' : null),
}));

import {
  AREA_TRACE_PIXELS_PER_MM,
  buildCameraTraceImage,
  TRACE_PIXELS_PER_MM,
  tracePixelsPerMm,
} from './trace-from-camera';

const lens = wideLens(64);
const FRAME: RgbaImage = {
  data: new Uint8ClampedArray(lens.imageWidth * lens.imageHeight * 4).fill(128),
  width: lens.imageWidth,
  height: lens.imageHeight,
};

function build(args: {
  readonly bedWidthMm?: number;
  readonly region?: { x: number; y: number; width: number; height: number } | null;
}) {
  return buildCameraTraceImage({
    raw: FRAME,
    lens,
    pose: overheadPose(),
    bedWidthMm: args.bedWidthMm ?? 10,
    bedHeightMm: 10,
    surfaceHeightMm: 3,
    heightAreas: [{ id: 'box', x: 2, y: 2, width: 4, height: 4, surfaceHeightMm: 20 }],
    region: args.region ?? null,
  });
}

beforeEach(() => {
  encoder.works = true;
});

describe('buildCameraTraceImage', () => {
  it('fails typed for an empty bed', () => {
    expect(build({ bedWidthMm: 0 })).toEqual({ kind: 'failed', reason: 'warp-failed' });
  });

  it('fails typed when the picture cannot be encoded', () => {
    encoder.works = false;
    expect(build({})).toEqual({ kind: 'failed', reason: 'encode-failed' });
  });

  it('pictures the whole bed at the whole-bed density', () => {
    const result = build({});
    if (result.kind !== 'ok') throw new Error('expected a trace source');
    expect(result.source.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(result.source.pixelWidth).toBe(10 * TRACE_PIXELS_PER_MM);
  });

  it('pictures one area where it lies on the bed, at the area density', () => {
    const result = build({ region: { x: 2, y: 3, width: 5, height: 4 } });
    if (result.kind !== 'ok') throw new Error('expected a trace source');
    expect(result.source.bounds).toEqual({ minX: 2, minY: 3, maxX: 7, maxY: 7 });
    expect(result.source.pixelWidth).toBe(5 * AREA_TRACE_PIXELS_PER_MM);
    expect(result.source.pixelHeight).toBe(4 * AREA_TRACE_PIXELS_PER_MM);
  });
});

describe('tracePixelsPerMm', () => {
  it('keeps the whole-bed density for the whole bed and doubles it for a small area', () => {
    expect(tracePixelsPerMm(null)).toBe(TRACE_PIXELS_PER_MM);
    expect(tracePixelsPerMm({ x: 0, y: 0, width: 120, height: 80 })).toBe(AREA_TRACE_PIXELS_PER_MM);
  });

  it('lowers the density for a large area, never below the whole-bed density', () => {
    const large = tracePixelsPerMm({ x: 0, y: 0, width: 700, height: 500 });
    expect(large).toBeGreaterThan(TRACE_PIXELS_PER_MM);
    expect(large).toBeLessThan(AREA_TRACE_PIXELS_PER_MM);
    expect(tracePixelsPerMm({ x: 0, y: 0, width: 3000, height: 3000 })).toBe(TRACE_PIXELS_PER_MM);
  });
});
