// Line + fill width metadata reaches the V-carve consumer (ADR-443): a traced
// pen line with a steady width carries strokeWidthMm, and a V-carve layer
// turns it into a closed round-stroke outline the pen's width across, instead
// of carving a zero-width centreline.

import { describe, expect, it } from 'vitest';
import { collectLayerContours } from '../../cnc/collect-cnc-contours';
import { DEFAULT_DEVICE_PROFILE } from '../../devices';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  type Layer,
  type TracedImage,
} from '../../scene';
import type { RawImageData } from '../trace-image';
import { TRACE_PRESETS } from '../trace-presets';
import { HYBRID_STROKE_COLOR } from './hybrid-paths';
import { traceHybridPaths } from './trace-hybrid';

const MM_PER_PX = 0.1;

// A horizontal 3 px pen line 60 px long, and a solid 24 px block it runs into.
function image(): RawImageData {
  const width = 120;
  const height = 60;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x: number, y: number): void => {
    data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  };
  for (let y = 29; y < 32; y += 1) for (let x = 10; x < 70; x += 1) ink(x, y);
  for (let y = 18; y < 42; y += 1) for (let x = 70; x < 94; x += 1) ink(x, y);
  return { width, height, data };
}

function vcarveLayer(color: string, cutType: 'v-carve' | 'profile-on-path'): Layer {
  return {
    ...createLayer({ id: `op-${cutType}`, color }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType },
  };
}

function tracedObject(): TracedImage {
  const paths = traceHybridPaths(image(), {
    ...TRACE_PRESETS['Centerline']!,
    traceMode: 'hybrid',
    hybridMaxStrokeWidthPx: 4,
  });
  return {
    kind: 'traced-image',
    id: 'hybrid',
    source: 'mixed.png',
    traceMode: 'hybrid',
    bounds: { minX: 0, minY: 0, maxX: 120, maxY: 60 },
    transform: { ...IDENTITY_TRANSFORM, scaleX: MM_PER_PX, scaleY: MM_PER_PX },
    paths,
  };
}

describe('Line + fill strokes on a V-carve layer', () => {
  it('carries a steady pen width on the traced stroke path', () => {
    const stroke = tracedObject().paths.find((path) => path.color === HYBRID_STROKE_COLOR);
    expect(stroke?.strokeWidthMm).toBeGreaterThanOrEqual(2.75);
    expect(stroke?.strokeWidthMm).toBeLessThanOrEqual(3.5);
  });

  it('carves the stroke as a closed round-stroke outline the pen width across', () => {
    const object = tracedObject();
    const carved = collectLayerContours(
      [object],
      vcarveLayer(HYBRID_STROKE_COLOR, 'v-carve'),
      DEFAULT_DEVICE_PROFILE,
    );
    expect(carved.length).toBeGreaterThan(0);
    expect(carved.every((contour) => contour.polyline.closed)).toBe(true);
    const ys = carved.flatMap((contour) => contour.polyline.points.map((p) => p.y));
    const across = Math.max(...ys) - Math.min(...ys);
    // 3 px at 0.1 mm/px: the outline spans the pen, not a zero-width line.
    expect(across).toBeGreaterThan(0.25);
    expect(across).toBeLessThan(0.4);
  });

  it('keeps the bare centreline on a non-V-carve layer', () => {
    const carved = collectLayerContours(
      [tracedObject()],
      vcarveLayer(HYBRID_STROKE_COLOR, 'profile-on-path'),
      DEFAULT_DEVICE_PROFILE,
    );
    expect(carved.length).toBeGreaterThan(0);
    expect(carved.some((contour) => !contour.polyline.closed)).toBe(true);
  });
});
