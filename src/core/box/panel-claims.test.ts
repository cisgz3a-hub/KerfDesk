import { describe, expect, it } from 'vitest';
import type { BoxSpec } from './box-spec';
import { buildPanelClaims, type PanelClaims, type SideId } from './panel-claims';

const SPEC: BoxSpec = {
  widthMm: 60,
  depthMm: 40,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
};

function panel(claims: ReadonlyArray<PanelClaims>, id: string): PanelClaims {
  const found = claims.find((c) => c.panel === id);
  if (found === undefined) throw new Error(`missing panel ${id}`);
  return found;
}

function ownedFlags(claims: PanelClaims, side: SideId): ReadonlyArray<boolean> {
  return claims.sides[side].map((interval) => interval.owned);
}

describe('buildPanelClaims — closed box', () => {
  const claims = buildPanelClaims(SPEC);

  it('produces six panels with outer face sizes', () => {
    expect(claims.map((c) => c.panel)).toEqual(['bottom', 'top', 'front', 'back', 'left', 'right']);
    const bottom = panel(claims, 'bottom');
    expect(bottom.sizeUMm).toBe(66);
    expect(bottom.sizeVMm).toBe(46);
    const left = panel(claims, 'left');
    expect(left.sizeUMm).toBe(46);
    expect(left.sizeVMm).toBe(36);
  });

  it('gives the bottom its corner squares plus the even cells', () => {
    // x edges: interior 60 / target 9 → 5 cells of 12 mm.
    expect(ownedFlags(panel(claims, 'bottom'), 'vMin')).toEqual([
      true,
      true,
      false,
      true,
      false,
      true,
      true,
    ]);
  });

  it('derives the front bottom edge as the exact complement', () => {
    const bottomSide = panel(claims, 'bottom').sides.vMin;
    const frontSide = panel(claims, 'front').sides.vMin;
    expect(frontSide.length).toBe(bottomSide.length);
    frontSide.forEach((interval, i) => {
      const mate = bottomSide[i];
      expect(interval.fromMm).toBe(mate?.fromMm);
      expect(interval.toMm).toBe(mate?.toMm);
      if (i > 0 && i < frontSide.length - 1) expect(interval.owned).toBe(!mate?.owned);
    });
  });

  it('keeps vertical edges complementary between front and left', () => {
    const frontSide = panel(claims, 'front').sides.uMin;
    const leftSide = panel(claims, 'left').sides.uMin;
    frontSide.forEach((interval, i) => {
      const mate = leftSide[i];
      expect(interval.fromMm).toBe(mate?.fromMm);
      if (i > 0 && i < frontSide.length - 1) expect(interval.owned).toBe(!mate?.owned);
    });
    // Front (Y) is the primary over left (X): it owns the even cells.
    expect(ownedFlags(panel(claims, 'front'), 'uMin')).toEqual([false, true, false, true, false]);
  });

  it('claims every corner cube for exactly one of its three panels', () => {
    // Origin corner: bottom (Z) wins over front (Y) and left (X).
    expect(panel(claims, 'bottom').sides.vMin[0]?.owned).toBe(true);
    expect(panel(claims, 'front').sides.vMin[0]?.owned).toBe(false);
    expect(panel(claims, 'left').sides.vMin[0]?.owned).toBe(false);
  });

  it('makes opposite panels identical (interchangeable)', () => {
    const strip = (c: PanelClaims): unknown => ({ ...c, panel: 'x' });
    expect(strip(panel(claims, 'front'))).toEqual(strip(panel(claims, 'back')));
    expect(strip(panel(claims, 'left'))).toEqual(strip(panel(claims, 'right')));
    expect(strip(panel(claims, 'bottom'))).toEqual(strip(panel(claims, 'top')));
  });
});

describe('buildPanelClaims — open-top box', () => {
  const claims = buildPanelClaims({ ...SPEC, style: 'open-top' });

  it('drops the top panel', () => {
    expect(claims.map((c) => c.panel)).toEqual(['bottom', 'front', 'back', 'left', 'right']);
  });

  it('flattens wall top edges and hands top corners to the Y panels', () => {
    const front = panel(claims, 'front');
    expect(front.sides.vMax).toEqual([
      { fromMm: 0, toMm: 3, owned: true },
      { fromMm: 3, toMm: 63, owned: true },
      { fromMm: 63, toMm: 66, owned: true },
    ]);
    const left = panel(claims, 'left');
    expect(ownedFlags(left, 'vMax')).toEqual([false, true, false]);
  });

  it('keeps bottom corners with the bottom panel', () => {
    expect(panel(claims, 'bottom').sides.vMin[0]?.owned).toBe(true);
  });
});
