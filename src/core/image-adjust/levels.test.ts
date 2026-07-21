import { describe, expect, it } from 'vitest';
import { IDENTITY_LEVELS, levelsLut } from './levels';

describe('levelsLut', () => {
  it('identity params give the identity LUT', () => {
    const lut = levelsLut(IDENTITY_LEVELS);
    for (const i of [0, 1, 100, 128, 254, 255]) expect(lut[i]).toBe(i);
  });

  it('input black/white points remap the endpoints', () => {
    const lut = levelsLut({ ...IDENTITY_LEVELS, inBlack: 50, inWhite: 200 });
    expect(lut[50]).toBe(0);
    expect(lut[49]).toBe(0);
    expect(lut[200]).toBe(255);
    expect(lut[210]).toBe(255);
    expect(lut[125] ?? 0).toBeGreaterThan(120);
  });

  it('gamma 2 lifts the midtones without moving the endpoints', () => {
    const lut = levelsLut({ ...IDENTITY_LEVELS, gamma: 2 });
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
    expect(lut[128] ?? 0).toBeGreaterThan(160);
  });

  it('output range compresses into [outBlack, outWhite]', () => {
    const lut = levelsLut({ ...IDENTITY_LEVELS, outBlack: 40, outWhite: 200 });
    expect(lut[0]).toBe(40);
    expect(lut[255]).toBe(200);
  });

  it('a collapsed input range degenerates to a step, not NaN', () => {
    const lut = levelsLut({ ...IDENTITY_LEVELS, inBlack: 128, inWhite: 128 });
    expect(lut[127]).toBe(0);
    expect(lut[200]).toBe(255);
  });
});
