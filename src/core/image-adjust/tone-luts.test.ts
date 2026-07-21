import { describe, expect, it } from 'vitest';
import {
  brightnessContrastLut,
  grayscaleLut,
  invertLut,
  posterizeLut,
  thresholdLut,
} from './tone-luts';

describe('brightnessContrastLut', () => {
  it('is the identity at (0, 0)', () => {
    const lut = brightnessContrastLut(0, 0);
    for (const i of [0, 1, 64, 128, 200, 255]) expect(lut[i]).toBe(i);
  });

  it('brightness shifts values up and clamps at white', () => {
    const lut = brightnessContrastLut(50, 0);
    expect(lut[100] ?? 0).toBeGreaterThan(100);
    expect(lut[255]).toBe(255);
    expect(lut[250]).toBe(255);
  });

  it('contrast -100 flattens everything to mid-grey', () => {
    const lut = brightnessContrastLut(0, -100);
    expect(lut[0]).toBe(128);
    expect(lut[255]).toBe(128);
  });

  it('contrast +100 approaches a hard step about mid-grey', () => {
    const lut = brightnessContrastLut(0, 100);
    expect(lut[100]).toBe(0);
    expect(lut[156]).toBe(255);
  });
});

describe('invertLut', () => {
  it('is its own inverse', () => {
    const lut = invertLut();
    expect(lut[0]).toBe(255);
    expect(lut[255]).toBe(0);
    expect(lut[lut[77] ?? 0]).toBe(77);
  });
});

describe('posterizeLut', () => {
  it('two levels binarize about the midpoint', () => {
    const lut = posterizeLut(2);
    expect(lut[0]).toBe(0);
    expect(lut[127]).toBe(0);
    expect(lut[128]).toBe(255);
    expect(lut[255]).toBe(255);
  });

  it('four levels produce exactly four distinct outputs spanning 0..255', () => {
    const seen = new Set(posterizeLut(4));
    expect(seen.size).toBe(4);
    expect(seen.has(0)).toBe(true);
    expect(seen.has(255)).toBe(true);
  });
});

describe('thresholdLut', () => {
  it('splits exactly at the level', () => {
    const lut = thresholdLut(200);
    expect(lut[199]).toBe(0);
    expect(lut[200]).toBe(255);
  });
});

describe('grayscaleLut', () => {
  it('is the identity map', () => {
    const lut = grayscaleLut();
    for (const i of [0, 128, 255]) expect(lut[i]).toBe(i);
  });
});
