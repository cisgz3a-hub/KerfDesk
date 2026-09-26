import { describe, expect, it } from 'vitest';
import { cuttingSurfaceDz } from '../sim/tool-kernels';
import type { CncTool } from '../scene';
import { cncLayoutCutWidths } from './layout-cut-widths';

// Amana 46282: a 1/16" ball tip, 5.4 degrees per side, 6.25 mm across the top
// of its 1" flutes (ADR-368).
const TBN: CncTool = {
  id: 'tbn',
  name: 'Tapered ball nose',
  kind: 'tapered-ball-nose',
  diameterMm: 6.25,
  tipAngleDeg: 10.8,
  tipDiameterMm: 1.5875,
};

describe('cncLayoutCutWidths', () => {
  it('keeps the stored diameter for every other cutter kind', () => {
    const others: ReadonlyArray<CncTool> = [
      { id: 'em', name: 'End mill', kind: 'end-mill', diameterMm: 3.175 },
      { id: 'bn', name: 'Ball nose', kind: 'ball-nose', diameterMm: 6.35 },
      { id: 'v', name: 'V-bit', kind: 'v-bit', diameterMm: 12.7, tipAngleDeg: 60 },
      {
        id: 'eng',
        name: 'Engraver',
        kind: 'engraving',
        diameterMm: 3.175,
        tipAngleDeg: 30,
        tipDiameterMm: 0.2,
      },
    ];
    for (const tool of others) {
      for (const [depthMm, perPassMm] of [
        [0.5, 0.5],
        [3, 1.5],
        [12, 2],
      ] as const) {
        expect(cncLayoutCutWidths(tool, depthMm, perPassMm)).toEqual({
          wallDiameterMm: tool.diameterMm,
          clearingDiameterMm: tool.diameterMm,
        });
      }
    }
  });

  it('gives a tapered ball nose its cut width at the full depth and over one pass', () => {
    const widths = cncLayoutCutWidths(TBN, 3, 1.5);
    // 2 * (R cos a + (h - R(1 - sin a)) tan a) at h = 3 and h = 1.5.
    expect(widths.wallDiameterMm).toBeCloseTo(2.0117, 4);
    expect(widths.clearingDiameterMm).toBeCloseTo(1.7281, 4);
    // A single pass engages the same width for both.
    const onePass = cncLayoutCutWidths(TBN, 1, 1.5);
    expect(onePass.clearingDiameterMm).toBe(onePass.wallDiameterMm);
  });

  it('is the width the removal kernel cuts at the stock surface', () => {
    for (const [depthMm, perPassMm] of [
      [0.4, 0.4],
      [3, 1.5],
      [6, 1.5],
      [20, 3],
    ] as const) {
      const widths = cncLayoutCutWidths(TBN, depthMm, perPassMm);
      const radiusMm = TBN.diameterMm / 2;
      expect(cuttingSurfaceDz(TBN, widths.wallDiameterMm / 2, radiusMm)).toBeCloseTo(depthMm, 9);
      expect(cuttingSurfaceDz(TBN, widths.clearingDiameterMm / 2, radiusMm)).toBeCloseTo(
        Math.min(perPassMm, depthMm),
        9,
      );
    }
  });

  it('caps at the stored diameter past the modeled flutes', () => {
    expect(cncLayoutCutWidths(TBN, 40, 40)).toEqual({
      wallDiameterMm: 6.25,
      clearingDiameterMm: 6.25,
    });
  });

  it('plans an unmodeled tapered ball nose, or no depth, at the stored diameter', () => {
    const { tipDiameterMm: _tip, ...noTip } = TBN;
    const stored = { wallDiameterMm: 6.25, clearingDiameterMm: 6.25 };
    expect(cncLayoutCutWidths(noTip, 3, 1.5)).toEqual(stored);
    expect(cncLayoutCutWidths({ ...TBN, tipAngleDeg: 0 }, 3, 1.5)).toEqual(stored);
    expect(cncLayoutCutWidths(TBN, 0, 1.5)).toEqual(stored);
    expect(cncLayoutCutWidths(TBN, Number.NaN, 1.5)).toEqual(stored);
  });

  it('takes the whole depth in one pass when the depth per pass is unusable', () => {
    const whole = cncLayoutCutWidths(TBN, 3, 0);
    expect(whole.clearingDiameterMm).toBe(whole.wallDiameterMm);
  });
});
