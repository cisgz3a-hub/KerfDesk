import { describe, expect, it } from 'vitest';
import { defaultSecondPassBrushDiameterMm } from './second-pass-brush-default';

describe('defaultSecondPassBrushDiameterMm', () => {
  it('takes a twelfth of the shorter side, rounded to hundredths', () => {
    expect(defaultSecondPassBrushDiameterMm({ minX: 0, minY: 0, maxX: 20, maxY: 60 })).toBe(1.67);
    expect(defaultSecondPassBrushDiameterMm({ minX: 5, minY: 5, maxX: 65, maxY: 25 })).toBe(1.67);
  });

  it('never shows floating-point noise for a raster whose span divides unevenly', () => {
    const diameter = defaultSecondPassBrushDiameterMm({
      minX: 0.05,
      minY: 0.05,
      maxX: 9.95,
      maxY: 9.95,
    });
    expect(diameter).toBe(0.82);
    expect(String(diameter)).toHaveLength(4);
  });

  it('never drops below a tenth of a millimetre for tiny engravings', () => {
    expect(defaultSecondPassBrushDiameterMm({ minX: 0, minY: 0, maxX: 0.5, maxY: 0.5 })).toBe(0.1);
    expect(defaultSecondPassBrushDiameterMm({ minX: 0, minY: 0, maxX: 0, maxY: 0 })).toBe(0.1);
  });
});
