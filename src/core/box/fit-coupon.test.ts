import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { fitCouponClearanceMm, generateFitCoupon, type FitCouponSpec } from './fit-coupon';

const SPEC: FitCouponSpec = {
  thicknessMm: 3,
  fingerWidthMm: 9,
  startClearanceMm: 0.05,
  stepClearanceMm: 0.05,
  rungCount: 6,
  relief: { kind: 'none' },
};

function runs(ring: Polyline, yValue: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < ring.points.length; i += 1) {
    const p = ring.points[i];
    const q = ring.points[i + 1];
    if (p === undefined || q === undefined) continue;
    if (p.y !== yValue || q.y !== yValue || p.x === q.x) continue;
    out.push([Math.min(p.x, q.x), Math.max(p.x, q.x)]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

describe('generateFitCoupon', () => {
  it('bakes the production fit law per rung: notch − tab == cᵢ', () => {
    const result = generateFitCoupon(SPEC);
    expect(result.kind).toBe('generated');
    if (result.kind !== 'generated') return;
    const comb = result.parts[0];
    const slots = result.parts[1];
    expect(comb?.name).toBe('Fit comb');
    expect(slots?.name).toBe('Fit slots');
    if (comb === undefined || slots === undefined) return;
    // Comb tab tips sit at body + T = 13; slot notch floors one T down.
    const tabTips = runs(comb.rings.outline, 13);
    const combTop = runs(comb.rings.outline, 10);
    expect(tabTips).toHaveLength(SPEC.rungCount);
    const slotBase = 10 + 3 + 6;
    const notchFloors = runs(slots.rings.outline, slotBase + 10 + 3 - 3);
    expect(notchFloors).toHaveLength(SPEC.rungCount);
    for (let i = 0; i < SPEC.rungCount; i += 1) {
      const c = fitCouponClearanceMm(SPEC, i);
      const tab = tabTips[i];
      const notch = notchFloors[i];
      if (tab === undefined || notch === undefined) continue;
      expect(tab[1] - tab[0]).toBeCloseTo(9 - c / 2, 9);
      expect(notch[1] - notch[0]).toBeCloseTo(9 + c / 2, 9);
      expect(notch[1] - notch[0] - (tab[1] - tab[0])).toBeCloseTo(c, 9);
    }
    expect(combTop.length).toBeGreaterThan(0);
  });

  it('orients the ladder with asymmetric margins (½f start, 2f end)', () => {
    const result = generateFitCoupon(SPEC);
    if (result.kind !== 'generated') throw new Error(result.kind);
    const comb = result.parts[0];
    if (comb === undefined) return;
    const tabTips = runs(comb.rings.outline, 13);
    const first = tabTips[0];
    const last = tabTips[tabTips.length - 1];
    const stripEnd = Math.max(...comb.rings.outline.points.map((p) => p.x));
    // Rung 0 starts half a finger in; two fingers of margin close the strip.
    expect(first?.[0]).toBeCloseTo(4.5 + 0.05 / 4, 9);
    if (last !== undefined) expect(stripEnd - last[1]).toBeCloseTo(2 * 9 + 0.3 / 4, 9);
  });

  it('rejects a ladder that reaches half the joint dimension', () => {
    const result = generateFitCoupon({ ...SPEC, rungCount: 12, stepClearanceMm: 0.2 });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.issues[0]?.message).toContain('top rung');
  });

  it('rejects non-integer or out-of-range rung counts', () => {
    expect(generateFitCoupon({ ...SPEC, rungCount: 1 }).kind).toBe('invalid');
    expect(generateFitCoupon({ ...SPEC, rungCount: 2.5 }).kind).toBe('invalid');
  });

  it('is deterministic and applies CNC reliefs without severing', () => {
    const cnc: FitCouponSpec = { ...SPEC, relief: { kind: 'corner-overcut', toolDiameterMm: 3.175 } };
    const a = generateFitCoupon(cnc);
    expect(a.kind).toBe('generated');
    expect(JSON.stringify(a)).toBe(JSON.stringify(generateFitCoupon(cnc)));
    if (a.kind !== 'generated') return;
    // Reliefs add vertices at every reflex corner (tab roots, notch corners).
    const plain = generateFitCoupon(SPEC);
    if (plain.kind !== 'generated') return;
    expect(a.parts[1]?.rings.outline.points.length ?? 0).toBeGreaterThan(
      plain.parts[1]?.rings.outline.points.length ?? 0,
    );
  });
});
