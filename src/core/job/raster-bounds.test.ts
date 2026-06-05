import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { IDENTITY_TRANSFORM, type RasterImage } from '../scene';
import { rasterBoundsInMachineCoords } from './raster-bounds';

function raster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    color: '#808080',
    source: 'x.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
  };
}

describe('rasterBoundsInMachineCoords', () => {
  it('preserves the mm extent of an identity-transformed image', () => {
    const b = rasterBoundsInMachineCoords(raster(), DEFAULT_DEVICE_PROFILE);
    // Origin handling may translate/flip, but the extent is invariant.
    expect(b.maxX - b.minX).toBeCloseTo(10, 6);
    expect(b.maxY - b.minY).toBeCloseTo(20, 6);
  });

  it('scales the extent with the object transform', () => {
    const scaled = { ...raster(), transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 3 } };
    const b = rasterBoundsInMachineCoords(scaled, DEFAULT_DEVICE_PROFILE);
    expect(b.maxX - b.minX).toBeCloseTo(20, 6);
    expect(b.maxY - b.minY).toBeCloseTo(60, 6);
  });
});
