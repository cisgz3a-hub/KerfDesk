// Line + fill Max stroke width: millimetres on the placed artwork become
// preview-grid pixels for the tracer (ADR-454).

import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import { TRACE_PRESETS } from '../../core/trace';
import {
  defaultHybridMaxStrokeWidthMm,
  hybridMaxStrokeWidthMm,
  previewPxPerMm,
  withHybridMaxStrokeWidth,
} from './hybrid-stroke-width';

const spot = (mm: number) => ({ laserSubProfile: { spotSizeMm: { x: mm, y: mm } } }) as never;

describe('Line + fill Max stroke width', () => {
  it('defaults to three burn spots with a 0.25 mm floor', () => {
    expect(defaultHybridMaxStrokeWidthMm(spot(0.2), 'laser')).toBeCloseTo(0.6);
    expect(defaultHybridMaxStrokeWidthMm(spot(0.05), 'laser')).toBe(0.25);
    expect(defaultHybridMaxStrokeWidthMm(undefined, 'cnc')).toBeCloseTo(0.3);
  });

  it('prefers the operator value and ignores a non-positive one', () => {
    expect(hybridMaxStrokeWidthMm({ hybridMaxStrokeWidthMm: 1.5 }, spot(0.2), 'laser')).toBe(1.5);
    expect(hybridMaxStrokeWidthMm({ hybridMaxStrokeWidthMm: 0 }, spot(0.2), 'laser')).toBeCloseTo(
      0.6,
    );
  });

  it('measures preview pixels per placed millimetre', () => {
    // 4000 px wide placed at 100 mm: the preview caps the long edge.
    const source = {
      pixelWidth: 4000,
      pixelHeight: 2000,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
      transform: IDENTITY_TRANSFORM,
    };
    const density = previewPxPerMm(source, 1000);
    expect(density).toBeCloseTo(10);
    expect(previewPxPerMm({ ...source, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } })).toBe(
      null,
    );
  });

  it('converts only a Line + fill trace, and only when the placement is known', () => {
    const hybrid = TRACE_PRESETS['Line + fill'];
    const centerline = TRACE_PRESETS['Centerline'];
    if (hybrid === undefined || centerline === undefined) throw new Error('missing preset');
    expect(withHybridMaxStrokeWidth(hybrid, 0.5, 10).hybridMaxStrokeWidthPx).toBe(5);
    expect(withHybridMaxStrokeWidth(hybrid, 0.05, 10).hybridMaxStrokeWidthPx).toBe(1);
    expect(withHybridMaxStrokeWidth(hybrid, 0.5, null)).toBe(hybrid);
    expect(withHybridMaxStrokeWidth(centerline, 0.5, 10)).toBe(centerline);
  });
});
