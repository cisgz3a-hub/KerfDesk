import { describe, expect, it } from 'vitest';
import { lumaAdjustmentLut } from './luma-adjust';
import { lumaHistogram, portraitAutoTones } from './portrait-auto-tones';

function histogramOf(levels: ReadonlyArray<readonly [level: number, count: number]>): Uint32Array {
  const histogram = new Uint32Array(256);
  for (const [level, count] of levels) histogram[level] = count;
  return histogram;
}

/** A spread of tones from `lo` to `hi`, evenly weighted. */
function rampHistogram(lo: number, hi: number): Uint32Array {
  const levels: Array<readonly [number, number]> = [];
  for (let level = lo; level <= hi; level += 1) levels.push([level, 100]);
  return histogramOf(levels);
}

function curve(histogram: Uint32Array): Uint8Array {
  const tones = portraitAutoTones(histogram);
  if (tones === null) throw new Error('expected tones');
  return lumaAdjustmentLut(tones) ?? Uint8Array.from({ length: 256 }, (_, i) => i);
}

describe('portraitAutoTones (ADR-685)', () => {
  it('counts every level', () => {
    expect(Array.from(lumaHistogram([0, 0, 128, 255])).filter((n) => n > 0)).toEqual([2, 1, 1]);
  });

  it('makes the lightest tones blank and the darkest solid, in the shipping tone curve', () => {
    const histogram = rampHistogram(30, 220);
    const lut = curve(histogram);
    // The 0.5% levels (30 and 220 here) become solid and blank; tones past them clamp.
    expect(lut[30]).toBeLessThanOrEqual(1);
    expect(lut[220]).toBeGreaterThanOrEqual(254);
    expect(lut[10]).toBe(0);
    expect(lut[240]).toBe(255);
    for (let level = 1; level < 256; level += 1) {
      expect(lut[level] ?? 0).toBeGreaterThanOrEqual(lut[level - 1] ?? 0);
    }
  });

  it('keeps the median tone where it was', () => {
    const histogram = histogramOf([
      [20, 10],
      [90, 40],
      [140, 60],
      [200, 40],
      [230, 10],
    ]);
    const lut = curve(histogram);
    expect(Math.abs((lut[140] ?? 0) - 140)).toBeLessThanOrEqual(1);
  });

  it('ignores pure white, so a removed background does not hide the skin highlights', () => {
    const face = rampHistogram(40, 210);
    const withBackground = Uint32Array.from(face);
    withBackground[255] = 1_000_000;
    expect(portraitAutoTones(withBackground)).toEqual(portraitAutoTones(face));
  });

  it('caps the stretch at the contrast control maximum', () => {
    const tones = portraitAutoTones(rampHistogram(120, 140));
    expect(tones?.contrast).toBe(100);
  });

  it('leaves a full-range photo almost unchanged', () => {
    const tones = portraitAutoTones(rampHistogram(0, 254));
    expect(tones).not.toBeNull();
    expect(Math.abs(tones?.contrast ?? 0)).toBeLessThan(2);
    expect(Math.abs(tones?.brightness ?? 0)).toBeLessThan(1);
    expect(Math.abs((tones?.gamma ?? 1) - 1)).toBeLessThan(0.02);
  });

  it('declines a photo with no tone to work with', () => {
    expect(portraitAutoTones(new Uint32Array(256))).toBeNull();
    expect(portraitAutoTones(histogramOf([[255, 50]]))).toBeNull();
    expect(portraitAutoTones(histogramOf([[128, 50]]))).toBeNull();
  });
});

// O6-P3-2 (ADR-685 Amendment 2): brightness and contrast round to a tenth.
// Rounded to nearest, the 0.5% level could land a fraction of a level above 0,
// and the midtone gamma lifted that by up to 50 levels.
describe('the darkest 0.5% stays solid after the controls round', () => {
  function firstLevelAtShare(histogram: Uint32Array, share: number): number {
    let total = 0;
    for (let level = 0; level < 255; level += 1) total += histogram[level] ?? 0;
    let seen = 0;
    for (let level = 0; level < 255; level += 1) {
      seen += histogram[level] ?? 0;
      if (seen >= share * total && seen > 0) return level;
    }
    return 254;
  }

  it('maps the 0.5% level to 0 on two-tone portraits', () => {
    for (let dark = 20; dark <= 150; dark += 1) {
      for (const light of [dark + 40, dark + 80, Math.min(254, dark + 120)]) {
        const levels: Array<readonly [number, number]> = [];
        for (let level = dark; level <= dark + 12; level += 1) levels.push([level, 30]);
        for (let level = dark + 13; level <= light; level += 1) levels.push([level, 60]);
        const histogram = histogramOf(levels);
        const lo = firstLevelAtShare(histogram, 0.005);
        expect(curve(histogram)[lo]).toBe(0);
      }
    }
  });

  it('burns a uniform dark backdrop solid instead of grey', () => {
    const levels: Array<readonly [number, number]> = [[113, 6000]];
    for (let level = 114; level <= 212; level += 1) levels.push([level, 40]);
    expect(curve(histogramOf(levels))[113]).toBe(0);
  });
});
