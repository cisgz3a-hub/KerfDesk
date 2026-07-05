// Chipload calculator (ADR-103 G5): the feed law, band selection, material
// factors, rounding, and floors.

import { describe, expect, it } from 'vitest';
import { calculateFeeds, chiploadFor, isChiploadMaterialKey } from './feeds-calculator';

describe('isChiploadMaterialKey', () => {
  it('accepts every known material and rejects everything else', () => {
    for (const key of ['softwood', 'hardwood', 'plywood-mdf', 'acrylic', 'aluminum']) {
      expect(isChiploadMaterialKey(key)).toBe(true);
    }
    for (const bad of ['unobtainium', '', 'ALUMINUM', undefined, null, 3, {}]) {
      expect(isChiploadMaterialKey(bad)).toBe(false);
    }
  });
});

describe('chiploadFor', () => {
  it('selects the diameter band, inclusive at the boundary', () => {
    expect(chiploadFor('hardwood', 1.0)).toBe(0.02);
    expect(chiploadFor('hardwood', 3.175)).toBe(0.04);
    expect(chiploadFor('hardwood', 6.35)).toBe(0.1);
    expect(chiploadFor('hardwood', 12)).toBe(0.15);
  });
});

describe('calculateFeeds', () => {
  it('applies feed = rpm × flutes × chipload, rounded to 10 mm/min', () => {
    // 18000 × 2 × 0.11 = 3960 for a 1/4" bit in plywood.
    const r = calculateFeeds({
      material: 'plywood-mdf',
      bitDiameterMm: 6.35,
      flutes: 2,
      rpm: 18000,
    });
    expect(r.feedMmPerMin).toBe(3960);
    expect(r.plungeMmPerMin).toBe(1580); // 40%, rounded to 10
    expect(r.depthPerPassMm).toBeCloseTo(3.2, 9); // 0.5 × 6.35 rounded to 0.1
  });

  it('aluminum runs far more conservatively than softwood', () => {
    const wood = calculateFeeds({
      material: 'softwood',
      bitDiameterMm: 3.175,
      flutes: 2,
      rpm: 12000,
    });
    const alu = calculateFeeds({
      material: 'aluminum',
      bitDiameterMm: 3.175,
      flutes: 2,
      rpm: 12000,
    });
    expect(alu.feedMmPerMin).toBeLessThan(wood.feedMmPerMin / 2);
    expect(alu.depthPerPassMm).toBeLessThan(wood.depthPerPassMm / 3);
  });

  it('floors tiny results instead of emitting zero feeds', () => {
    const r = calculateFeeds({ material: 'aluminum', bitDiameterMm: 1, flutes: 1, rpm: 1000 });
    expect(r.feedMmPerMin).toBeGreaterThanOrEqual(50);
    expect(r.plungeMmPerMin).toBeGreaterThanOrEqual(25);
    expect(r.depthPerPassMm).toBeGreaterThanOrEqual(0.1);
  });

  it('keeps outputs finite when rpm/flutes are non-finite (D-S04-003)', () => {
    for (const bad of [
      { material: 'softwood', bitDiameterMm: 6.35, flutes: 2, rpm: Number.NaN },
      { material: 'softwood', bitDiameterMm: 6.35, flutes: 2, rpm: Number.POSITIVE_INFINITY },
      { material: 'softwood', bitDiameterMm: 6.35, flutes: Number.POSITIVE_INFINITY, rpm: 18000 },
    ] as const) {
      const r = calculateFeeds(bad);
      expect(Number.isFinite(r.feedMmPerMin)).toBe(true);
      expect(Number.isFinite(r.plungeMmPerMin)).toBe(true);
      expect(Number.isFinite(r.depthPerPassMm)).toBe(true);
      expect(r.feedMmPerMin).toBeGreaterThanOrEqual(50);
      expect(r.plungeMmPerMin).toBeGreaterThanOrEqual(25);
      expect(r.depthPerPassMm).toBeGreaterThanOrEqual(0.1);
    }
  });
});
