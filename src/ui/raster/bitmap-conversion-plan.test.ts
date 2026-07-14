// Convert-to-Bitmap size/DPI planning (ADR-029).
//
// The estimate must agree with the actual conversion for ANY transform —
// the 2026-07-07 audit found the dialog approving rotated conversions the
// builder then refused (estimate ignored rotation). And the conversion DPI
// becomes the created image layer's linesPerMm, so the legal DPI range must
// derive from the app-wide raster density limits or Convert creates layers
// the Cuts panel considers out of range.

import { describe, expect, it } from 'vitest';
import { MAX_RASTER_LINES_PER_MM, MIN_RASTER_LINES_PER_MM, MM_PER_INCH } from '../../core/raster';
import {
  IDENTITY_TRANSFORM,
  transformedBounds,
  type Bounds,
  type Transform,
} from '../../core/scene';
import {
  DEFAULT_CONVERT_TO_BITMAP_DPI,
  MAX_CONVERT_TO_BITMAP_DPI,
  MIN_CONVERT_TO_BITMAP_DPI,
  estimateBitmapConversion,
  normalizeConvertToBitmapDpi,
} from './bitmap-conversion-plan';

const SQUARE_180: Bounds = { minX: 0, minY: 0, maxX: 180, maxY: 180 };
const ROT_45: Transform = { ...IDENTITY_TRANSFORM, rotationDeg: 45 };

describe('estimateBitmapConversion transform handling', () => {
  it('accounts for rotation: a 45°-rotated square estimates its rotated AABB', () => {
    // 180 mm at 45° spans 180·√2 ≈ 254.56 mm → 2546 px at 10 lines/mm.
    const plan = estimateBitmapConversion({ bounds: SQUARE_180, transform: ROT_45 });
    expect(plan.pixelWidth).toBe(2546);
    expect(plan.pixelHeight).toBe(2546);
    // This formerly tripped the blunt 4M-pixel ceiling. Its measured working
    // set fits, so the dialog and builder now allow it.
    expect(plan.verdict.kind).toBe('ok');
  });

  it('matches the baked-bounds estimate the builder uses, for any transform', () => {
    const transform: Transform = {
      x: 12,
      y: -7,
      scaleX: 1.5,
      scaleY: 0.75,
      rotationDeg: 30,
      mirrorX: true,
      mirrorY: false,
    };
    const fromDialogInputs = estimateBitmapConversion({ bounds: SQUARE_180, transform });
    const fromBakedBounds = estimateBitmapConversion({
      bounds: transformedBounds(SQUARE_180, transform),
      transform: IDENTITY_TRANSFORM,
    });
    expect(fromDialogInputs.pixelWidth).toBe(fromBakedBounds.pixelWidth);
    expect(fromDialogInputs.pixelHeight).toBe(fromBakedBounds.pixelHeight);
  });

  it('still applies plain scale and mirror to the physical size', () => {
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 20, maxY: 10 };
    const plan = estimateBitmapConversion({
      bounds,
      transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 3, mirrorX: true },
    });
    expect(plan.pixelWidth).toBe(400); // 40 mm × 10 lines/mm
    expect(plan.pixelHeight).toBe(300); // 30 mm × 10 lines/mm
  });
});

describe('conversion DPI range derives from the raster density limits', () => {
  it('bounds the DPI by MIN/MAX_RASTER_LINES_PER_MM so created layers stay legal', () => {
    expect(MIN_CONVERT_TO_BITMAP_DPI).toBe(MIN_RASTER_LINES_PER_MM * MM_PER_INCH);
    expect(MAX_CONVERT_TO_BITMAP_DPI).toBe(MAX_RASTER_LINES_PER_MM * MM_PER_INCH);
    expect(DEFAULT_CONVERT_TO_BITMAP_DPI).toBe(254);
  });

  it('clamps out-of-range DPI to the derived bounds', () => {
    expect(normalizeConvertToBitmapDpi(1200)).toBe(MAX_CONVERT_TO_BITMAP_DPI);
    expect(normalizeConvertToBitmapDpi(10)).toBe(MIN_CONVERT_TO_BITMAP_DPI);
    expect(normalizeConvertToBitmapDpi(Number.NaN)).toBe(DEFAULT_CONVERT_TO_BITMAP_DPI);
  });

  it('never plans a layer density above the app-wide maximum', () => {
    const plan = estimateBitmapConversion(
      { bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 }, transform: IDENTITY_TRANSFORM },
      10_000,
    );
    expect(plan.linesPerMm).toBeLessThanOrEqual(MAX_RASTER_LINES_PER_MM);
  });
});
