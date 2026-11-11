import { describe, expect, it } from 'vitest';
import { lumaAdjustmentLut } from './luma-adjust';

// O6-P3-3: values no control produces, from a hand-edited project file. NaN
// turned every level to 0 (a solid burn) and contrast below -100 reversed the
// curve; both now fall back to the nearest valid setting.
describe('out-of-range tones from a hand-edited project', () => {
  it('treats NaN as the default and keeps the curve rising', () => {
    expect(
      lumaAdjustmentLut({ brightness: Number.NaN, contrast: Number.NaN, gamma: Number.NaN }),
    ).toBeNull();
    expect(lumaAdjustmentLut({ brightness: 10, gamma: Number.NaN })).toEqual(
      lumaAdjustmentLut({ brightness: 10 }),
    );
  });

  it('flattens contrast below -100 to grey instead of reversing it', () => {
    const lut = lumaAdjustmentLut({ contrast: -150 });
    expect(lut).toEqual(lumaAdjustmentLut({ contrast: -100 }));
    for (let level = 1; level < 256; level += 1) {
      expect(lut?.[level] ?? 0).toBeGreaterThanOrEqual(lut?.[level - 1] ?? 0);
    }
  });
});
