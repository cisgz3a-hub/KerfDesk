import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { DEFAULT_TAB_SPACING_MM, tabCountRule } from './tab-spacing';
import { applyAutomaticTabsToPolylines, type AutomaticTabsSettings } from './tabs-bridges';

function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

const SPACING: AutomaticTabsSettings = {
  tabsEnabled: true,
  tabSizeMm: 1,
  tabsPerShape: 4,
  tabSkipInnerShapes: true,
  tabPlacement: 'spacing',
  tabSpacingMm: 30,
};

describe('tabCountRule', () => {
  it('keeps the per-shape count unless spacing is chosen', () => {
    expect(tabCountRule({ tabsPerShape: 3 })(1000)).toBe(3);
    expect(tabCountRule({ tabsPerShape: 3, tabPlacement: 'per-shape' })(5)).toBe(3);
    expect(tabCountRule({ tabsPerShape: 0 })(100)).toBe(1);
  });

  it('uses the fewest tabs that keep every bridge within the spacing', () => {
    const count = tabCountRule(SPACING);
    expect(count(100)).toBe(4); // 25 mm bridges, not 30 + 30 + 30 + 10
    expect(count(90)).toBe(3); // an exact multiple gains no extra tab
    expect(count(90.000000001)).toBe(3);
    expect(count(91)).toBe(4);
  });

  it('clamps to the per-shape minimum and maximum', () => {
    expect(tabCountRule(SPACING)(5)).toBe(1);
    expect(tabCountRule({ ...SPACING, tabMinPerShape: 2 })(5)).toBe(2);
    expect(tabCountRule({ ...SPACING, tabMaxPerShape: 6 })(1000)).toBe(6);
    // A maximum below the minimum cannot win.
    expect(tabCountRule({ ...SPACING, tabMinPerShape: 3, tabMaxPerShape: 2 })(1000)).toBe(3);
  });

  it('falls back to safe defaults for unusable values', () => {
    const count = tabCountRule({ ...SPACING, tabSpacingMm: 0, tabMinPerShape: Number.NaN });
    expect(count(DEFAULT_TAB_SPACING_MM * 2)).toBe(2);
  });
});

describe('automatic tabs with spacing', () => {
  it('splits each outer shape by its own perimeter and still skips holes', () => {
    const outer = square(0, 0, 40); // 160 mm → 6 tabs at 30 mm spacing
    const hole = square(10, 10, 20);
    const small = square(100, 0, 5); // 20 mm → the 1-tab minimum
    const out = applyAutomaticTabsToPolylines([outer, hole, small], SPACING);
    const bridges = out.filter((polyline) => !polyline.closed);
    const closed = out.filter((polyline) => polyline.closed);
    expect(closed).toEqual([hole]);
    const outerBridges = bridges.filter((polyline) => polyline.points.every((p) => p.x <= 40));
    const smallBridges = bridges.filter((polyline) => polyline.points.every((p) => p.x >= 100));
    expect(outerBridges).toHaveLength(6);
    expect(smallBridges).toHaveLength(1);
  });

  it('leaves per-shape output exactly as before', () => {
    const shapes = [square(0, 0, 40), square(10, 10, 20)];
    const legacy = applyAutomaticTabsToPolylines(shapes, {
      tabsEnabled: true,
      tabSizeMm: 1,
      tabsPerShape: 3,
      tabSkipInnerShapes: true,
    });
    const explicit = applyAutomaticTabsToPolylines(shapes, {
      tabsEnabled: true,
      tabSizeMm: 1,
      tabsPerShape: 3,
      tabSkipInnerShapes: true,
      tabPlacement: 'per-shape',
      tabSpacingMm: 5,
      tabMinPerShape: 9,
    });
    expect(explicit).toEqual(legacy);
  });
});
