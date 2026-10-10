import { describe, expect, it } from 'vitest';
import { describeStlImportSize, stlImportSize } from './stl-import-size';

// ADR-578: an STL comes in at its own millimetres, every axis at one scale.

const bounds = (x: number, y: number, z: number) => ({
  minX: -x / 2,
  maxX: x / 2,
  minY: 3,
  maxY: 3 + y,
  minZ: -1,
  maxZ: -1 + z,
});
const bed = { bedWidthMm: 400, bedHeightMm: 300, stockThicknessMm: 20 };

describe('stlImportSize', () => {
  it('keeps a model at its own size, its height as the relief depth', () => {
    const size = stlImportSize(bounds(60, 40, 12), bed);
    expect(size).toMatchObject({
      targetWidthMm: 60,
      reliefDepthMm: 12,
      scale: 1,
      reason: 'model-size',
    });
    expect(size.heightMm).toBeCloseTo(40, 12);
    expect(describeStlImportSize(size, bed)).toEqual({
      sizeText: '60 × 40 mm and 12 mm deep (its own size)',
      notice: null,
    });
  });

  it('shrinks a model larger than the bed on every axis alike', () => {
    const size = stlImportSize(bounds(800, 300, 50), bed);
    expect(size.scale).toBeCloseTo(0.5, 12);
    expect(size).toMatchObject({ targetWidthMm: 400, reliefDepthMm: 25, reason: 'fit-bed' });
    expect(describeStlImportSize(size, bed).notice).toMatch(/400 × 300 mm bed.*50%.*proportions/);
  });

  it('brings a model under a millimetre across up to the default width', () => {
    const size = stlImportSize(bounds(0.06, 0.04, 0.012), bed);
    expect(size.reason).toBe('tiny-model');
    expect(size.targetWidthMm).toBeCloseTo(100, 9);
    expect(size.reliefDepthMm).toBeCloseTo(20, 9);
  });

  it('gives a flat model the default depth', () => {
    const size = stlImportSize(bounds(60, 40, 0), bed);
    expect(size).toMatchObject({ flat: true, reliefDepthMm: 5 });
  });

  it('says when the model is taller than the stock, without rescaling it', () => {
    const size = stlImportSize(bounds(60, 40, 32), bed);
    expect(size.reliefDepthMm).toBe(32);
    expect(describeStlImportSize(size, bed).notice).toMatch(/32 mm tall.*20 mm stock.*two-sided/);
  });
});
