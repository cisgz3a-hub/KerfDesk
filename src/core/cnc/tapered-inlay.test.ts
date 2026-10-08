import { describe, expect, it } from 'vitest';
import { offsetClosedPolylinesWithRoundJoins } from '../geometry/kerf-offset';
import { type CncTool, type Polyline } from '../scene';
import { DEFAULT_CNC_TAPERED_INLAY } from '../scene/cnc-tapered-inlay';
import { inlayBounds } from './tapered-inlay-geometry';
import { planTaperedInlayPair } from './tapered-inlay';
import {
  normalizeCncTaperedInlay,
  taperedInlayContactAtDepth,
  taperedInlayPlugDepth,
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
function minX(contours: ReadonlyArray<Polyline>): number {
  return inlayBounds(contours)?.minX ?? NaN;
}

describe('linked tapered inlay contact geometry', () => {
  it.each([30, 60, 90, 120])(
    'preserves independent radial fit on an analytic circular wall at %s degrees',
    (angle) => {
      const source = [circle(10)];
      const plan = planTaperedInlayPair(source, INTENT, bit(angle));
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.reason);
      const slope = Math.tan((angle * Math.PI) / 360);
      for (const depth of [0, 0.5, 1, 2]) {
        const femaleSection = offsetClosedPolylinesWithRoundJoins(
          plan.femaleContours,
          -depth * slope,
        );
        const maleDepth = INTENT.engagementDepthMm - depth;
        const maleSection = offsetClosedPolylinesWithRoundJoins(
          plan.plugTopContours,
          maleDepth * slope,
        );
        expect(minX(maleSection) - minX(femaleSection)).toBeCloseTo(INTENT.fitClearanceMm, 2);
        expect(taperedInlayContactAtDepth(INTENT, angle, depth).radialGapMm).toBeCloseTo(0.08, 10);
      }
      expect(INTENT.pocketDepthMm - INTENT.engagementDepthMm).toBe(0.5);
      expect(taperedInlayPlugDepth(INTENT) - INTENT.engagementDepthMm).toBe(1);
    },
  );

  it('keeps glue, surface clearance and radial clearance as separate dimensions', () => {
    const base = planTaperedInlayPair([circle(10)], INTENT, bit(60));
    const glue = taperedInlayValuePatch(INTENT, 'glueGapMm', 0.9);
    const surface = taperedInlayValuePatch(INTENT, 'surfaceClearanceMm', 1.4);
    expect(glue.pocketDepthMm).toBe(2.9);
    expect(taperedInlayPlugDepth(glue)).toBe(3);
    expect(surface.pocketDepthMm).toBe(2.5);
    expect(taperedInlayPlugDepth(surface)).toBe(3.4);
    expect(planTaperedInlayPair([circle(10)], glue, bit(60))).toMatchObject(
      base.ok ? { plugTopContours: base.plugTopContours } : {},
    );
    expect(planTaperedInlayPair([circle(10)], surface, bit(60))).toMatchObject(
      base.ok ? { plugTopContours: base.plugTopContours } : {},
    );
    const fit = taperedInlayValuePatch(INTENT, 'fitClearanceMm', 0.3);
    expect(fit.pocketDepthMm).toBe(2.5);
    expect(fit.glueGapMm).toBe(0.5);
  });

  it('retains and reports a lost narrow island while carving reachable artwork', () => {
    const plan = planTaperedInlayPair([circle(10), box(50, 1)], INTENT, bit(90));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.femaleContours.length).toBe(2);
    expect(plan.plugTopContours.length).toBe(1);
    expect(plan.lostDetailAreaMm2).toBeGreaterThan(19);
    expect(plan.findings.join(' ')).toContain('narrow details');
  });

  it('reports an entirely unreachable design instead of claiming an empty matching plug', () => {
    expect(planTaperedInlayPair([box(0, 1)], INTENT, bit(90))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('No source detail'),
    });
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
});
