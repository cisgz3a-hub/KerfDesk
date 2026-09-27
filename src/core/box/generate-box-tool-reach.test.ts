// CNC relief fabrication contract, end to end (ADR-106 Amd 1): with corner
// relief on, the shipped profile-outside toolpath of every generated part
// must bring the bit's centre within one radius of every seat corner, so
// square tabs seat. A drawn relief the compensated bit cannot enter leaves
// a radius-r fillet in every corner, which is what the pre-amendment
// corner-centred overcut did.

import { describe, expect, it } from 'vitest';
import { bitReachesSeatCorners } from '../../__fixtures__/property/box-benchmark-support';
import type { BoxSpec } from './box-spec';
import { generateFitCoupon } from './fit-coupon';
import { generateBox, type BoxPanel } from './generate-box';

const TOOL_MM = 3.175;

const BASE: BoxSpec = {
  widthMm: 100,
  depthMm: 80,
  heightMm: 50,
  dimensionMode: 'inner',
  thicknessMm: 6,
  targetFingerWidthMm: 18,
  style: 'closed',
  clearanceMm: 0.15,
  relief: { kind: 'none' },
  partSpacingMm: 12,
};

function panelsOf(spec: BoxSpec): ReadonlyArray<BoxPanel> {
  const result = generateBox(spec);
  if (result.kind !== 'generated') throw new Error(JSON.stringify(result));
  return result.panels;
}

function unreachedParts(spec: BoxSpec, toolMm: number): string[] {
  const plain = panelsOf(spec);
  const relieved = panelsOf({
    ...spec,
    relief: { kind: 'corner-overcut', toolDiameterMm: toolMm },
  });
  return relieved.flatMap((panel, index) => {
    const nominal = plain[index];
    // The loose lid's thumb notch is a handhold, never a seat.
    if (nominal === undefined || panel.panel === 'lid') return [];
    return bitReachesSeatCorners(nominal, panel, toolMm) ? [] : [panel.name];
  });
}

describe('CNC corner relief — the compensated bit reaches every seat corner', () => {
  for (const style of ['closed', 'open-top', 'slide-lid'] as const) {
    for (const clearanceMm of [0.15, 0.3]) {
      it(`${style} box with dividers at ${clearanceMm} mm clearance`, () => {
        const spec: BoxSpec = { ...BASE, style, clearanceMm, dividersXCount: 2, dividersYCount: 1 };
        expect(unreachedParts(spec, TOOL_MM)).toEqual([]);
      });
    }
  }

  it('holds for a 1/8 in bit in thin stock and a 6 mm bit in thick stock', () => {
    expect(
      unreachedParts({ ...BASE, thicknessMm: 3, targetFingerWidthMm: 9, clearanceMm: 0.1 }, 3.175),
    ).toEqual([]);
    expect(
      unreachedParts(
        {
          ...BASE,
          widthMm: 400,
          depthMm: 300,
          heightMm: 200,
          thicknessMm: 18,
          targetFingerWidthMm: 54,
        },
        6,
      ),
    ).toEqual([]);
  });

  it('fails without relief, so the check is not vacuous', () => {
    const plain = panelsOf(BASE);
    const front = plain.find((panel) => panel.panel === 'front');
    expect(front).toBeDefined();
    if (front === undefined) return;
    expect(bitReachesSeatCorners(front, front, TOOL_MM)).toBe(false);
  });

  it('holds for the Box Fit Test strips', () => {
    const spec = {
      thicknessMm: 6,
      fingerWidthMm: 12,
      startClearanceMm: 0.05,
      stepClearanceMm: 0.05,
      rungCount: 6,
    };
    const plain = generateFitCoupon({ ...spec, relief: { kind: 'none' } });
    const relieved = generateFitCoupon({
      ...spec,
      relief: { kind: 'corner-overcut', toolDiameterMm: TOOL_MM },
    });
    expect(plain.kind).toBe('generated');
    expect(relieved.kind).toBe('generated');
    if (plain.kind !== 'generated' || relieved.kind !== 'generated') return;
    relieved.parts.forEach((part, index) => {
      const nominal = plain.parts[index];
      expect(nominal).toBeDefined();
      if (nominal === undefined) return;
      expect(bitReachesSeatCorners(nominal.rings, part.rings, TOOL_MM)).toBe(true);
    });
  });
});
