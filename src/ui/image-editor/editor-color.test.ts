import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  hexToRgb,
  hsvToRgb,
  inkPercentToRgb,
  rgbToHex,
  rgbToHsv,
  rgbToInkPercent,
} from './editor-color';

describe('rgb ⇄ hsv', () => {
  it('maps the primary anchors exactly', () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 255, b: 0 }).h).toBe(120);
    expect(rgbToHsv({ r: 0, g: 0, b: 255 }).h).toBe(240);
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 });
    expect(hsvToRgb({ h: 0, s: 0, v: 1 })).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('round-trips every color within 1 step per channel', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (r, g, b) => {
          const back = hsvToRgb(rgbToHsv({ r, g, b }));
          expect(Math.abs(back.r - r)).toBeLessThanOrEqual(1);
          expect(Math.abs(back.g - g)).toBeLessThanOrEqual(1);
          expect(Math.abs(back.b - b)).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('hex parsing', () => {
  it('round-trips and accepts short/hash-less forms', () => {
    expect(rgbToHex({ r: 18, g: 52, b: 86 })).toBe('#123456');
    expect(hexToRgb('#123456')).toEqual({ r: 18, g: 52, b: 86 });
    expect(hexToRgb('fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#ABC')).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb('nope')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
  });
});

describe('ink percent', () => {
  it('anchors black/white and round-trips grays', () => {
    expect(rgbToInkPercent({ r: 255, g: 255, b: 255 })).toBe(0);
    expect(rgbToInkPercent({ r: 0, g: 0, b: 0 })).toBe(100);
    expect(inkPercentToRgb(0)).toEqual({ r: 255, g: 255, b: 255 });
    expect(inkPercentToRgb(100)).toEqual({ r: 0, g: 0, b: 0 });
    const mid = inkPercentToRgb(50);
    expect(rgbToInkPercent(mid)).toBe(50);
  });
});
