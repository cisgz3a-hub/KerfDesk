import { describe, expect, it } from 'vitest';
import type { CncTool } from '../../core/scene';
import { toolProfile } from '../../core/sim';
import { bitPreviewProfile } from './bit-preview-profile';

function vBit(overrides: Partial<CncTool> = {}): CncTool {
  return {
    id: 'v90',
    name: '90 degree V-bit',
    kind: 'v-bit',
    diameterMm: 12.7,
    tipAngleDeg: 90,
    ...overrides,
  };
}

describe('bitPreviewProfile', () => {
  it('keeps the simulator profile exact when a known narrow shank differs', () => {
    const tool = vBit({ shankDiameterMm: 6.35 });

    expect(bitPreviewProfile(tool)).toEqual(toolProfile(tool));
  });

  it.each([1.588, 6.35])(
    'does not invent a flat-cutter transition for a %s mm shank',
    (shankDiameterMm) => {
      const tool: CncTool = {
        id: 'flat',
        name: 'Flat end mill',
        kind: 'end-mill',
        diameterMm: 3.175,
        shankDiameterMm,
      };
      const preview = bitPreviewProfile(tool);
      const minimumHeightMm = Math.min(...preview.map((point) => point.heightMm));
      const minimumHeightRadiusMm = Math.max(
        ...preview
          .filter((point) => point.heightMm === minimumHeightMm)
          .map((point) => point.radiusMm),
      );

      expect(preview).toEqual(toolProfile(tool));
      expect(minimumHeightRadiusMm).toBeCloseTo(tool.diameterMm / 2);
    },
  );

  it('leaves the core profile unchanged when shank diameter is unknown', () => {
    const tool = vBit();

    expect(bitPreviewProfile(tool)).toEqual(toolProfile(tool));
    expect(bitPreviewProfile({ ...tool, shankDiameterMm: Number.NaN })).toEqual(toolProfile(tool));
  });

  it('refuses to invent a V-bit cone when the included angle is missing', () => {
    const { tipAngleDeg: _removed, ...withoutAngle } = vBit();
    expect(() => bitPreviewProfile(withoutAngle)).toThrow(/valid 1–179° included angle/i);
  });

  it.each([0, 180, Number.NaN])(
    'refuses to invent a V-bit cone for invalid included angle %s',
    (tipAngleDeg) => {
      expect(() => bitPreviewProfile(vBit({ tipAngleDeg }))).toThrow(
        /valid 1–179° included angle/i,
      );
    },
  );

  // An engraving bit is a truncated cone. Once CncTool could carry the tip land
  // (tipDiameterMm) the envelope became modelable, so the refusal narrowed from
  // "every engraving bit" to "one whose included angle is unknown".
  it('models an engraving bit that carries a valid included angle', () => {
    const profile = bitPreviewProfile({
      id: 'engraver',
      name: '15 degree engraving bit',
      kind: 'engraving',
      diameterMm: 3.175,
      tipAngleDeg: 15,
    });
    expect(profile.length).toBeGreaterThan(0);
  });

  it('models the flat tip land as a truncated cone', () => {
    const pointed = bitPreviewProfile({
      id: 'pointed',
      name: 'pointed engraver',
      kind: 'engraving',
      diameterMm: 3.175,
      tipAngleDeg: 30,
    });
    const truncated = bitPreviewProfile({
      id: 'truncated',
      name: 'flat-tip engraver',
      kind: 'engraving',
      diameterMm: 3.175,
      tipAngleDeg: 30,
      tipDiameterMm: 0.4,
    });
    // The land lowers the flank: at any radius inside it the cutter is still at
    // its tip height, so the truncated profile never rises above the pointed one.
    const highest = (points: ReadonlyArray<{ readonly heightMm: number }>): number =>
      points.reduce((peak, point) => Math.max(peak, point.heightMm), 0);
    expect(highest(truncated)).toBeLessThan(highest(pointed));
  });

  it('still refuses an engraving bit whose included angle is unknown', () => {
    expect(() =>
      bitPreviewProfile({
        id: 'engraver',
        name: 'legacy engraving bit',
        kind: 'engraving',
        diameterMm: 3.175,
      }),
    ).toThrow(/included angle.*no engraving cone was modeled/i);
  });
});
