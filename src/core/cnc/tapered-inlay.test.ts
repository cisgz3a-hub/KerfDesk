import { describe, expect, it } from 'vitest';
import { type CncTool, type Polyline } from '../scene';
import { DEFAULT_CNC_TAPERED_INLAY } from '../scene/cnc-tapered-inlay';
import { inlayBounds } from './tapered-inlay-geometry';
import { planTaperedInlayPair } from './tapered-inlay';
import {
  normalizeCncTaperedInlay,
  taperedInlayContactAtDepth,
  taperedInlayPlugDepth,
  taperedInlayWallStartDepth,
} from './tapered-inlay-settings';
import { taperedInlayValuePatch } from '../../ui/layers/tapered-inlay-value-patch';

const INTENT = {
  ...DEFAULT_CNC_TAPERED_INLAY,
  pocketDepthMm: 2.5,
  engagementDepthMm: 2,
  glueGapMm: 0.5,
  fitClearanceMm: 0.08,
};
function bit(angle: number): CncTool {
  return { id: 'v', name: 'Fixture V-bit', kind: 'v-bit', diameterMm: 20, tipAngleDeg: angle };
}
function circle(radius: number): Polyline {
  return {
    closed: true,
    points: Array.from({ length: 128 }, (_, index) => ({
      x: 20 + radius * Math.cos((index * Math.PI) / 64),
      y: 20 + radius * Math.sin((index * Math.PI) / 64),
    })),
  };
}
function box(x: number, width: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y: 0 },
      { x: x + width, y: 0 },
      { x: x + width, y: 20 },
      { x, y: 20 },
    ],
  };
}
describe('linked tapered inlay contact geometry', () => {
  it.each([30, 60, 90, 120])(
    'starts the plug walls at engagement plus the radial fit depth at %s degrees',
    (angle) => {
      const plan = planTaperedInlayPair([circle(10)], INTENT, bit(angle));
      if (!plan.ok) throw new Error(plan.reason);
      const slope = Math.tan((angle * Math.PI) / 360);
      // ADR-665: with every waste tip this much lower, the plug cut at a distance d inside the
      // mirrored outline is this depth minus d / slope, the pocket wall plus the fit gap.
      expect(plan.plugWallStartDepthMm).toBeCloseTo(
        INTENT.engagementDepthMm + INTENT.fitClearanceMm / slope,
        12,
      );
      expect(taperedInlayWallStartDepth(INTENT, angle)).toBe(plan.plugWallStartDepthMm);
      for (const depth of [0, 0.5, 1, 2])
        expect(taperedInlayContactAtDepth(INTENT, angle, depth).radialGapMm).toBeCloseTo(0.08, 10);
      expect(INTENT.pocketDepthMm - INTENT.engagementDepthMm).toBe(0.5);
      expect(taperedInlayPlugDepth(INTENT) - INTENT.engagementDepthMm).toBe(1);
    },
  );

  it('carves the plug waste around the whole source, mirrored, with its counters', () => {
    const plan = planTaperedInlayPair([circle(10), box(50, 1)], INTENT, bit(90));
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.femaleContours).toHaveLength(2);
    // The border plus one hole per source shape: nothing narrow is dropped (audit F5-P2-1).
    expect(plan.maleWasteContours).toHaveLength(3);
    const widths = plan.maleWasteContours
      .map((contour) => {
        const bounds = inlayBounds([contour]);
        return bounds === null ? NaN : bounds.maxX - bounds.minX;
      })
      .sort((a, b) => a - b);
    expect(widths[0]).toBeCloseTo(1, 9);
    expect(widths[1]).toBeCloseTo(20, 2);
    expect(plan.findings.join(' ')).not.toContain('cannot be reproduced');
  });

  it('keeps glue and surface clearance out of the plug walls, and fit in them', () => {
    const base = planTaperedInlayPair([circle(10)], INTENT, bit(60));
    if (!base.ok) throw new Error(base.reason);
    const glue = taperedInlayValuePatch(INTENT, 'glueGapMm', 0.9);
    const surface = taperedInlayValuePatch(INTENT, 'surfaceClearanceMm', 1.4);
    expect(glue.pocketDepthMm).toBe(2.9);
    expect(taperedInlayPlugDepth(glue)).toBe(3);
    expect(surface.pocketDepthMm).toBe(2.5);
    expect(taperedInlayPlugDepth(surface)).toBe(3.4);
    for (const intent of [glue, surface])
      expect(planTaperedInlayPair([circle(10)], intent, bit(60))).toMatchObject({
        maleWasteContours: base.maleWasteContours,
        plugWallStartDepthMm: base.plugWallStartDepthMm,
      });
    const fit = taperedInlayValuePatch(INTENT, 'fitClearanceMm', 0.3);
    expect(fit.pocketDepthMm).toBe(2.5);
    expect(fit.glueGapMm).toBe(0.5);
    const fitPlan = planTaperedInlayPair([circle(10)], fit, bit(60));
    if (!fitPlan.ok) throw new Error(fitPlan.reason);
    expect(fitPlan.plugWallStartDepthMm - base.plugWallStartDepthMm).toBeCloseTo(
      (0.3 - INTENT.fitClearanceMm) / Math.tan(Math.PI / 6),
      12,
    );
  });

  it('plans a stroke narrower than the engagement inset, which the opening refused', () => {
    const plan = planTaperedInlayPair([box(0, 1)], INTENT, bit(90));
    expect(plan).toMatchObject({ ok: true, femaleContours: [expect.anything()] });
  });

  it('keeps the plug waste border separated for either physical-right coordinate direction', () => {
    for (const direction of [1, -1] as const) {
      const plan = planTaperedInlayPair([circle(10)], INTENT, bit(60), direction);
      if (!plan.ok) throw new Error(plan.reason);
      const female = inlayBounds(plan.femaleContours)!;
      const male = inlayBounds(plan.maleWasteContours)!;
      expect(direction === 1 ? male.minX - female.maxX : female.minX - male.maxX).toBeCloseTo(
        INTENT.pairSpacingMm,
        6,
      );
    }
  });

  it.each([
    { ...INTENT, pocketDepthMm: 4 },
    { ...INTENT, engagementDepthMm: NaN },
    { ...INTENT, surfaceClearanceMm: 0 },
    { ...INTENT, kind: 'straight' },
  ])('does not normalize inconsistent or invalid intent %j', (value) => {
    expect(normalizeCncTaperedInlay(value)).toBeUndefined();
  });

  it('rejects unmodeled cutter geometry and insufficient plug border with named reasons', () => {
    expect(
      planTaperedInlayPair([circle(10)], INTENT, { ...bit(60), tipDiameterMm: 0.2 }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('flat tip') });
    expect(planTaperedInlayPair([circle(10)], INTENT, { ...bit(90), diameterMm: 2 })).toMatchObject(
      { ok: false, reason: expect.stringContaining('diameter') },
    );
    expect(
      planTaperedInlayPair([circle(10)], { ...INTENT, plugBorderMm: 0.1 }, bit(90)),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('Plug border') });
  });

  it('refuses a fit gap whose depth reaches the plug waste floor', () => {
    // 0.6 mm per side on a 60 degree bit starts the walls 1.04 mm down; the waste floor is 1 mm.
    expect(
      planTaperedInlayPair([circle(10)], { ...INTENT, fitClearanceMm: 0.6 }, bit(60)),
    ).toMatchObject({
      ok: false,
      reason:
        'Surface clearance must be more than 1.04 mm, the depth the radial fit gap adds to the plug walls on this V-bit.',
    });
    expect(
      planTaperedInlayPair([circle(10)], { ...INTENT, fitClearanceMm: 0.55 }, bit(60)).ok,
    ).toBe(true);
  });

  // CNC audit v2 J1-P3-2 (ADR-258 Amendment 8): the plug sinks fit / tan(half
  // angle) to close its walls; past the glue gap it bottoms out first.
  it('notes the seam a fit gap leaves when it closes deeper than the glue gap', () => {
    const seamed = planTaperedInlayPair([circle(10)], { ...INTENT, fitClearanceMm: 0.4 }, bit(60));
    if (!seamed.ok) throw new Error(seamed.reason);
    expect(seamed.findings.join(' ')).toContain(
      'The 0.4 mm radial fit gap closes only after the plug sinks 0.693 mm, deeper than the 0.5 mm glue gap',
    );
    expect(seamed.findings.join(' ')).toContain('about a 0.111 mm seam');

    const seated = planTaperedInlayPair([circle(10)], INTENT, bit(60));
    if (!seated.ok) throw new Error(seated.reason);
    expect(seated.findings.join(' ')).not.toContain('radial fit gap closes');
  });
});
