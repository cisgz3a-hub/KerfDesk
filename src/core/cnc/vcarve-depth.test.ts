import { describe, expect, it } from 'vitest';
import type { CncTool } from '../scene';
import { vcarveEffectiveDepthMm } from './vcarve-depth';

function tool(patch: Partial<CncTool> = {}, includeTipAngle = true): CncTool {
  return {
    id: 'v90-6',
    name: '6 mm 90 degree V-bit',
    kind: 'v-bit',
    diameterMm: 6,
    ...(includeTipAngle ? { tipAngleDeg: 90 } : {}),
    ...patch,
  };
}

describe('vcarveEffectiveDepthMm', () => {
  it('caps a requested depth at the V-bit cone height', () => {
    expect(vcarveEffectiveDepthMm(tool(), 10)).toBeCloseTo(3, 12);
    expect(vcarveEffectiveDepthMm(tool(), 2)).toBe(2);
  });

  it.each([undefined, 0.5, 179.5, Number.NaN])(
    'does not resolve invalid actual V-bit angle geometry: %s',
    (tipAngleDeg) => {
      expect(
        vcarveEffectiveDepthMm(
          tool(tipAngleDeg === undefined ? {} : { tipAngleDeg }, tipAngleDeg !== undefined),
          10,
        ),
      ).toBeNull();
    },
  );

  it('preserves the legacy non-V-bit angle fallback', () => {
    expect(vcarveEffectiveDepthMm(tool({ kind: 'end-mill' }, false), 10)).toBeCloseTo(
      3 / Math.tan(Math.PI / 6),
      12,
    );
  });

  it.each([0, -1, Number.NaN])('keeps the requested depth for diameter %s', (diameterMm) => {
    expect(vcarveEffectiveDepthMm(tool({ diameterMm }), 2)).toBe(2);
  });
});
