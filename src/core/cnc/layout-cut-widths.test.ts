import { describe, expect, it } from 'vitest';
import { cuttingSurfaceDz } from '../sim/tool-kernels';
import type { CncTool } from '../scene';
import { cncLayoutCutWidths, cncLayoutFallsBackToStoredDiameter } from './layout-cut-widths';

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
const END_MILL: CncTool = { id: 'em', name: 'End mill', kind: 'end-mill', diameterMm: 3.175 };
// The starter 1/4" ball nose and 60 degree V-bit, and a 30 degree engraver
// with a 0.2 mm flat at its tip.
const BALL: CncTool = { id: 'bn', name: 'Ball nose', kind: 'ball-nose', diameterMm: 6.35 };
const V_BIT: CncTool = {
  id: 'v',
  name: 'V-bit',
  kind: 'v-bit',
  diameterMm: 6.35,
  tipAngleDeg: 60,
};
const ENGRAVER: CncTool = {
  id: 'eng',
  name: 'Engraver',
  kind: 'engraving',
  diameterMm: 3.175,
  tipAngleDeg: 30,
  tipDiameterMm: 0.2,
};
const MODELED: ReadonlyArray<CncTool> = [BALL, V_BIT, ENGRAVER, TBN];
const TAN_30 = Math.tan(Math.PI / 6);
const TAN_15 = Math.tan(Math.PI / 12);

describe('cncLayoutCutWidths', () => {
  it('keeps a flat end mill on its stored diameter at every depth', () => {
    for (const [depthMm, perPassMm] of [
      [0.5, 0.5],
      [3, 1.5],
      [12, 2],
    ] as const) {
      expect(cncLayoutCutWidths(END_MILL, depthMm, perPassMm)).toEqual({
        wallDiameterMm: 3.175,
        clearingDiameterMm: 3.175,
      });
    }
  });

  it('gives a ball nose the width of its sphere until the cut is a radius deep', () => {
    // 2 sqrt(h (D - h)): 1 mm down the 6.35 mm ball cuts 4.626 mm wide, so a
    // wall offset by its radius stood 0.862 mm off the line.
    const oneMm = cncLayoutCutWidths(BALL, 1, 1.5);
    expect(oneMm.wallDiameterMm).toBeCloseTo(2 * Math.sqrt(1 * 5.35), 9);
    expect(oneMm.clearingDiameterMm).toBe(oneMm.wallDiameterMm);
    expect(3.175 - oneMm.wallDiameterMm / 2).toBeCloseTo(0.862, 3);
    // A radius deep it cuts its full diameter; each 1.5 mm pass still does not.
    const deep = cncLayoutCutWidths(BALL, 6, 1.5);
    expect(deep.wallDiameterMm).toBe(6.35);
    expect(deep.clearingDiameterMm).toBeCloseTo(2 * Math.sqrt(1.5 * 4.85), 9);
    expect(cncLayoutCutWidths(BALL, 12, 4)).toEqual({
      wallDiameterMm: 6.35,
      clearingDiameterMm: 6.35,
    });
  });

  it('gives a V-bit its cone width and an engraving bit its cone and tip flat', () => {
    // 2 h tan(30 deg): the 60 degree bit cuts 3.464 mm wide 3 mm down, so a
    // wall offset by its 3.175 mm radius stood 1.443 mm off the line.
    const vBit = cncLayoutCutWidths(V_BIT, 3, 1.5);
    expect(vBit.wallDiameterMm).toBeCloseTo(2 * 3 * TAN_30, 9);
    expect(vBit.clearingDiameterMm).toBeCloseTo(2 * 1.5 * TAN_30, 9);
    expect(3.175 - vBit.wallDiameterMm / 2).toBeCloseTo(1.443, 3);
    // 0.2 + 2 h tan(15 deg) for the flat-tipped engraver.
    const engraver = cncLayoutCutWidths(ENGRAVER, 1, 0.5);
    expect(engraver.wallDiameterMm).toBeCloseTo(0.2 + 2 * TAN_15, 9);
    expect(engraver.clearingDiameterMm).toBeCloseTo(0.2 + 2 * 0.5 * TAN_15, 9);
    // An engraver without a flat is a point, like a V-bit.
    const { tipDiameterMm: _flat, ...pointed } = ENGRAVER;
    expect(cncLayoutCutWidths(pointed, 1, 1).wallDiameterMm).toBeCloseTo(2 * TAN_15, 9);
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
    for (const tool of MODELED) {
      for (const [depthMm, perPassMm] of [
        [0.4, 0.4],
        [1, 0.5],
        [3, 1.5],
      ] as const) {
        const widths = cncLayoutCutWidths(tool, depthMm, perPassMm);
        const radiusMm = tool.diameterMm / 2;
        expect(widths.wallDiameterMm, tool.kind).toBeLessThan(tool.diameterMm);
        expect(cuttingSurfaceDz(tool, widths.wallDiameterMm / 2, radiusMm)).toBeCloseTo(depthMm, 9);
        expect(cuttingSurfaceDz(tool, widths.clearingDiameterMm / 2, radiusMm)).toBeCloseTo(
          perPassMm,
          9,
        );
      }
    }
  });

  it('caps at the stored diameter past the modeled flutes', () => {
    // The 60 degree cone reaches 6.35 mm 5.5 mm up; the ball, a radius up.
    for (const [tool, depthMm] of [
      [V_BIT, 6],
      [ENGRAVER, 6],
      [BALL, 3.2],
      [TBN, 40],
    ] as const) {
      expect(cncLayoutCutWidths(tool, depthMm, depthMm)).toEqual({
        wallDiameterMm: tool.diameterMm,
        clearingDiameterMm: tool.diameterMm,
      });
    }
  });

  it('plans a cutter it cannot model at the stored diameter and says so', () => {
    const { tipAngleDeg: _vAngle, ...vBitWithoutAngle } = V_BIT;
    const { tipAngleDeg: _engAngle, ...engraverWithoutAngle } = ENGRAVER;
    const { tipDiameterMm: _ball, ...tbnWithoutTip } = TBN;
    const unmodeled: ReadonlyArray<CncTool> = [
      vBitWithoutAngle,
      { ...V_BIT, tipAngleDeg: 0 },
      engraverWithoutAngle,
      // A flat as wide as the cutter is not a cone at all.
      { ...ENGRAVER, tipDiameterMm: 3.175 },
      tbnWithoutTip,
      { ...TBN, tipAngleDeg: 0 },
    ];
    for (const tool of unmodeled) {
      expect(cncLayoutCutWidths(tool, 3, 1.5), tool.name).toEqual({
        wallDiameterMm: tool.diameterMm,
        clearingDiameterMm: tool.diameterMm,
      });
      expect(cncLayoutFallsBackToStoredDiameter(tool), tool.name).toBe(true);
    }
    for (const tool of [END_MILL, ...MODELED]) {
      expect(cncLayoutFallsBackToStoredDiameter(tool), tool.name).toBe(false);
    }
  });

  it('plans no usable depth at the stored diameter', () => {
    for (const tool of MODELED) {
      const stored = { wallDiameterMm: tool.diameterMm, clearingDiameterMm: tool.diameterMm };
      expect(cncLayoutCutWidths(tool, 0, 1.5)).toEqual(stored);
      expect(cncLayoutCutWidths(tool, Number.NaN, 1.5)).toEqual(stored);
    }
  });

  it('takes the whole depth in one pass when the depth per pass is unusable', () => {
    for (const tool of MODELED) {
      const whole = cncLayoutCutWidths(tool, 3, 0);
      expect(whole.clearingDiameterMm).toBe(whole.wallDiameterMm);
    }
  });
});
