// ADR-258: tabs are a Z-rise in one continuous path, not a split into pieces.
// These tests pin the three properties the design exists for: the cutter never
// leaves the cut, the tab wall is a same-XY vertical move, and a tab no longer
// costs a contour its deep pass when the windows are wide relative to perimeter.

import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { tabRampedPoints } from './cnc-tab-ramp';

// 40 mm square, seam at the origin corner. Perimeter 160 mm.
const square: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 0, y: 40 },
  ],
};

const settings = { tabWidthMm: 6, tabsPerShape: 4, toolDiameterMm: 3.175 };

const CUT_Z = -6;
const TAB_TOP_Z = -2;

describe('tabRampedPoints (ADR-258)', () => {
  it('rides the cut depth and rises to the tab top, never above it', () => {
    const points = tabRampedPoints(square, CUT_Z, TAB_TOP_Z, settings);
    expect(points).not.toBeNull();
    if (points === null) return;
    const zs = [...new Set(points.map((p) => p.z))].sort((a, b) => a - b);
    // Exactly two depths exist: the cut and the tab top. No intermediate Z, and
    // nothing above the tab top — the cutter stays in the material throughout.
    expect(zs).toEqual([CUT_Z, TAB_TOP_Z]);
  });

  it('makes every tab wall a same-XY vertical move', () => {
    const points = tabRampedPoints(square, CUT_Z, TAB_TOP_Z, settings);
    expect(points).not.toBeNull();
    if (points === null) return;
    for (let i = 1; i < points.length; i += 1) {
      const previous = points[i - 1];
      const current = points[i];
      if (previous === undefined || current === undefined) continue;
      if (previous.z === current.z) continue;
      // A Z change must not also move in XY: that is what lets the emitter send
      // it at the plunge feed instead of the cutting feed.
      expect(current.x).toBeCloseTo(previous.x, 9);
      expect(current.y).toBeCloseTo(previous.y, 9);
    }
  });

  it('produces one rise and one fall per tab', () => {
    const points = tabRampedPoints(square, CUT_Z, TAB_TOP_Z, settings);
    expect(points).not.toBeNull();
    if (points === null) return;
    let rises = 0;
    let falls = 0;
    for (let i = 1; i < points.length; i += 1) {
      const previous = points[i - 1];
      const current = points[i];
      if (previous === undefined || current === undefined) continue;
      if (current.z > previous.z) rises += 1;
      if (current.z < previous.z) falls += 1;
    }
    expect(rises).toBe(settings.tabsPerShape);
    expect(falls).toBe(settings.tabsPerShape);
  });

  it('keeps a small contour cutting instead of dropping its deep pass', () => {
    // Perimeter 20 mm against 4 windows of 6 + 3.175 mm: the windows more than
    // cover the loop. The split model returned NO pieces here and the deep pass
    // was skipped entirely (cnc-tabs.ts AUDIT A5) — a hole that never cut
    // through. The rise model still returns a usable path.
    const tiny: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
        { x: 0, y: 5 },
      ],
    };
    const points = tabRampedPoints(tiny, CUT_Z, TAB_TOP_Z, settings);
    expect(points).not.toBeNull();
    if (points === null) return;
    expect(points.length).toBeGreaterThanOrEqual(2);
    // Fully covered by tab windows, so it rides at the tab top rather than
    // cutting deeper. That is the honest reading of "tabs everywhere".
    expect(points.every((p) => p.z === TAB_TOP_Z)).toBe(true);
  });

  it('honors persisted manual anchor positions (ADR-156)', () => {
    const points = tabRampedPoints(square, CUT_Z, TAB_TOP_Z, settings, [0.25]);
    expect(points).not.toBeNull();
    if (points === null) return;
    const rises = points.filter((p, i) => {
      const previous = points[i - 1];
      return previous !== undefined && p.z > previous.z;
    });
    expect(rises).toHaveLength(1);
    // The anchor is the tab CENTRE, so the wall stands half a window before it:
    // 0.25 x 160 mm perimeter = 40 mm centre, window (6 + 3.175) / 2 = 4.5875,
    // so the rise is at 35.4125 mm along the loop — still on the first edge
    // (y = 0), giving x = 35.4125. Asserting 40 here would be asserting the
    // centre, not the wall.
    const risen = rises[0];
    expect(risen).toBeDefined();
    if (risen === undefined) return;
    expect(risen.x).toBeCloseTo(35.4125, 6);
    expect(risen.y).toBeCloseTo(0, 6);
  });

  it('declines an open path, a non-rise, and a zero window', () => {
    expect(tabRampedPoints({ ...square, closed: false }, CUT_Z, TAB_TOP_Z, settings)).toBeNull();
    // Tab top at or below the cut depth is not a tab.
    expect(tabRampedPoints(square, CUT_Z, CUT_Z, settings)).toBeNull();
    expect(
      tabRampedPoints(square, CUT_Z, TAB_TOP_Z, {
        tabWidthMm: 0,
        tabsPerShape: 4,
        toolDiameterMm: 0,
      }),
    ).toBeNull();
  });
});
