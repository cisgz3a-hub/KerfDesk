import { describe, expect, it } from 'vitest';
import type { BoxSpec } from './box-spec';
import { compartmentPitchMm, dividerLayout, junctionCellBounds } from './divider-layout';
import { dividerName, dividerPanelRings, wallSlotCutouts } from './divider-panels';

// Inner 90×60×40 T=3: cw = (90−3)/2 = 43.5 → X-divider at 46.5;
// ch = (60−3)/2 = 28.5 → Y-divider at 31.5. Junction: interior 40,
// target 9 → 3 cells of 40/3; tab cell = cell 1.
const SPEC: BoxSpec = {
  widthMm: 90,
  depthMm: 60,
  heightMm: 40,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
  dividersXCount: 1,
  dividersYCount: 1,
};

describe('dividerLayout', () => {
  const layout = dividerLayout(SPEC);

  it('spaces dividers into equal compartments', () => {
    expect(layout.xDividers.map((p) => p.startMm)).toEqual([46.5]);
    expect(layout.yDividers.map((p) => p.startMm)).toEqual([31.5]);
    expect(compartmentPitchMm(90, 1, 3)).toBe(43.5);
  });

  it('runs the junction over the divider height with odd cells', () => {
    expect(layout.heightSpanMm).toBe(40);
    expect(layout.junction.cellCount).toBe(3);
    const tab = junctionCellBounds(layout, 1);
    expect(tab.fromMm).toBeCloseTo(40 / 3, 9);
    expect(tab.toMm).toBeCloseTo(80 / 3, 9);
  });

  it('extends divider height to the rim for open-top', () => {
    expect(dividerLayout({ ...SPEC, style: 'open-top' }).heightSpanMm).toBe(43);
  });
});

describe('dividerPanelRings / wallSlotCutouts', () => {
  const layout = dividerLayout(SPEC);

  it('names dividers by axis and one-based index', () => {
    const x0 = layout.xDividers[0];
    expect(x0 && dividerName(x0)).toBe('Divider X1');
  });

  it('gives the X-divider wall tabs and a top cross-lap at the Y slab', () => {
    const placement = layout.xDividers[0];
    if (placement === undefined) throw new Error('missing placement');
    const points = dividerPanelRings(layout, placement, SPEC).outline.points;
    const has = (x: number, y: number): boolean =>
      points.some((p) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9);
    // Tab bump reaches the outer face of the back wall (u = OD = 66).
    expect(has(66, 40 / 3)).toBe(true);
    expect(has(66, 80 / 3)).toBe(true);
    // Top cross-lap floor at half height across the Y slab [31.5, 34.5].
    expect(has(31.5, 20)).toBe(true);
    expect(has(34.5, 20)).toBe(true);
  });

  it('cuts one slot per tab cell per divider into the mating walls', () => {
    const slots = wallSlotCutouts(layout, SPEC);
    const front = slots.get('front');
    expect(front).toHaveLength(1);
    const box = front?.[0];
    const xs = box?.points.map((p) => p.x) ?? [];
    const ys = box?.points.map((p) => p.y) ?? [];
    expect(Math.min(...xs)).toBe(46.5);
    expect(Math.max(...xs)).toBe(49.5);
    // Wall v = z: junction cell shifted up by the bottom thickness.
    expect(Math.min(...ys)).toBeCloseTo(3 + 40 / 3, 9);
    expect(Math.max(...ys)).toBeCloseTo(3 + 80 / 3, 9);
    expect(slots.get('left')).toHaveLength(1);
    expect(slots.get('back')).toHaveLength(1);
  });
});
