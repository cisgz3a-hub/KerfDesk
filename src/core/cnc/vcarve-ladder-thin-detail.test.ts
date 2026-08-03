import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CncTool, Polyline } from '../scene';
import { vcarveLadderPasses, vcarvePasses } from './vcarve-ladder';

// ADR-282: strokes narrower than 2·δ used to vanish from the carve entirely —
// the first coarse inset already consumed them, so a thin script stroke
// contributed no rings while the rest of the glyph cut. The thin-detail stage
// must carve them with a fine-pitch ladder instead of dropping them. Split
// from vcarve-ladder.test.ts at the 400-line cap; the δ-ladder invariants
// stay there.

const VBIT_90: CncTool = {
  id: 'v90',
  name: '90° v-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 90,
};

function square(at: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: at, y: at },
      { x: at + size, y: at },
      { x: at + size, y: at + size },
      { x: at, y: at + size },
    ],
  };
}

function band(widthMm: number, lengthMm: number, atX = 0): Polyline {
  return {
    closed: true,
    points: [
      { x: atX, y: 0 },
      { x: atX + lengthMm, y: 0 },
      { x: atX + lengthMm, y: widthMm },
      { x: atX, y: widthMm },
    ],
  };
}

// δ rings stay constant-Z contours; detail rings are path3d since the
// junction blend (ADR-282 Amendment 2) — helpers read both.
function passXy(
  pass: ReturnType<typeof vcarvePasses>[number],
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  if (pass.kind === 'contour') return pass.polyline;
  if (pass.kind === 'path3d') return pass.points;
  return [];
}

function passDepths(passes: ReturnType<typeof vcarvePasses>): number[] {
  return passes.map((pass) => {
    if (pass.kind === 'contour') return pass.zMm;
    if (pass.kind === 'path3d') return Math.min(...pass.points.map((point) => point.z));
    return Number.NaN;
  });
}

function regionOrder(passes: ReturnType<typeof vcarvePasses>): string {
  return passes
    .map((pass) => {
      const xy = passXy(pass);
      if (xy.length === 0) return '?';
      return Math.max(...xy.map((point) => point.x)) < 10 ? 'L' : 'R';
    })
    .join('');
}

describe('vcarvePasses — thin detail (ADR-282)', () => {
  it('carves a stroke narrower than 2·δ instead of dropping it (the script-font bug)', () => {
    // 0.5 mm × 10 mm band, δ = 0.5: the first coarse inset exceeds the
    // 0.25 mm half-width, so the ring ladder alone yields nothing.
    const passes = vcarvePasses([band(0.5, 10)], {
      tool: VBIT_90,
      maxDepthMm: 2,
      depthPerPassMm: 2,
      resolutionMm: 0.5,
    });
    expect(passes.length).toBeGreaterThan(0);
    const depths = passDepths(passes);
    // Depth law: detail rings walk toward the band's centerline; the deepest
    // must approach half-width/tan(45°) = 0.25 without ever exceeding it.
    expect(Math.min(...depths)).toBeLessThanOrEqual(-0.15);
    expect(Math.min(...depths)).toBeGreaterThanOrEqual(-0.25 - 1e-9);
    for (const pass of passes) {
      for (const p of passXy(pass)) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.x).toBeLessThanOrEqual(10 + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1e-6);
        expect(p.y).toBeLessThanOrEqual(0.5 + 1e-6);
      }
    }
  });

  it('normalizes self-intersections before any offset can grow outside the artwork', () => {
    const bowTie: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 4 },
        { x: 0, y: 4 },
        { x: 20, y: 0 },
      ],
    };
    const ladder = vcarveLadderPasses([bowTie], {
      tool: VBIT_90,
      maxDepthMm: 2,
      depthPerPassMm: 2,
      resolutionMm: 0.5,
    });
    expect(ladder.offsetFailed).toBe(false);
    expect(ladder.passLimited).toBe(false);
    expect(ladder.passes.length).toBeGreaterThan(0);
    for (const pass of ladder.passes) {
      for (const point of passXy(pass)) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(20);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(4);
      }
    }
  });

  it('keeps normalized lobes as separate regions in original source order', () => {
    const bowTie: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 4 },
        { x: 0, y: 4 },
        { x: 20, y: 0 },
      ],
    };
    const passes = vcarvePasses([bowTie, square(30, 6)], {
      tool: VBIT_90,
      maxDepthMm: 2,
      depthPerPassMm: 2,
      resolutionMm: 0.5,
    });
    const order = passes
      .map((pass) => {
        const xy = passXy(pass);
        if (xy.some((point) => point.x > 25)) return 'S';
        const averageY = xy.reduce((sum, point) => sum + point.y, 0) / xy.length;
        return averageY < 2 ? 'A' : 'B';
      })
      .join('');

    expect(order).toMatch(/^(A+B+|B+A+)S+$/);
  });

  it('runs every variable-depth detail segment at the configured plunge feed', () => {
    const passes = vcarvePasses([band(0.5, 10)], {
      tool: VBIT_90,
      maxDepthMm: 2,
      depthPerPassMm: 2,
      resolutionMm: 0.5,
    });
    const detail = passes.filter((pass) => pass.kind === 'path3d');
    expect(detail.length).toBeGreaterThan(0);
    for (const pass of detail) expect(pass.lateralFeed).toBe('z-rate-capped');
  });

  it('falls back to the complete stepped profile when a ramp would flatten thin detail', () => {
    const options = {
      tool: VBIT_90,
      maxDepthMm: 2,
      depthPerPassMm: 0.1,
      resolutionMm: 0.5,
    };
    const stepped = vcarveLadderPasses([band(0.5, 10)], options);
    const rampRequested = vcarveLadderPasses([band(0.5, 10)], {
      ...options,
      rampAngleDeg: 3,
    });
    // An all-detail layer has no constant-depth ring to ramp, so its program is
    // unchanged and the advisory explains why.
    expect(rampRequested.passes).toEqual(stepped.passes);
    expect(rampRequested.entryIssue).toContain('thin-detail passes keep their');
  });

  it('still ramps the ring ladder when the layer ALSO has thin detail', () => {
    // Dropping the configured ramp for the whole layer the moment any thin
    // stroke appeared punished exactly the artwork this stage exists to carve:
    // in script lettering every glyph has a thin stroke, so ramp entry would
    // never apply. The δ rings are ordinary constant-depth contours and ramp
    // fine; only the variable-depth detail passes must stay stepped.
    const result = vcarveLadderPasses([square(30, 6), band(0.5, 10)], {
      tool: VBIT_90,
      maxDepthMm: 2,
      depthPerPassMm: 0.1,
      resolutionMm: 0.5,
      rampAngleDeg: 3,
    });
    const ramps = result.passes.filter((pass) => pass.kind === 'path3d' && pass.entryRamp === true);
    const detail = result.passes.filter(
      (pass) => pass.kind === 'path3d' && pass.lateralFeed === 'z-rate-capped',
    );

    expect(ramps.length).toBeGreaterThan(0);
    expect(detail.length).toBeGreaterThan(0);
    // The advisory still fires — the detail passes really did keep stepped entry.
    expect(result.entryIssue).toContain('thin-detail passes keep their');
  });

  it('detail passes respect the maxDepth clamp', () => {
    const passes = vcarvePasses([band(0.5, 10)], {
      tool: VBIT_90,
      maxDepthMm: 0.1,
      depthPerPassMm: 0.1,
      resolutionMm: 0.5,
    });
    expect(passes.length).toBeGreaterThan(0);
    for (const z of passDepths(passes)) {
      expect(z).toBeGreaterThanOrEqual(-0.1 - 1e-9);
      expect(z).toBeLessThan(0);
    }
  });

  it('still finishes each region — ladder and detail — before travelling on', () => {
    // Thick left square gets coarse rings; thin right band gets only detail
    // rings; the region-major promise must hold across both kinds (ADR-270).
    const passes = vcarvePasses([square(0, 6), band(0.5, 10, 20)], {
      tool: VBIT_90,
      maxDepthMm: 3,
      depthPerPassMm: 3,
      resolutionMm: 0.5,
    });
    expect(regionOrder(passes)).toMatch(/^L+R+$/);
  });

  it('finishes one sliver before travelling to the next within a region', () => {
    // One source region: a thick square with TWO thin fingers off its right
    // edge. Both fingers vanish from the δ ladder as separate slivers. Detail
    // passes must complete finger A (all its fine steps) before travelling to
    // finger B — not hop between fingers step by step.
    const glyph: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 6, y: 0.5 },
        { x: 12, y: 0.5 },
        { x: 12, y: 1 },
        { x: 6, y: 1 },
        { x: 6, y: 5 },
        { x: 12, y: 5 },
        { x: 12, y: 5.5 },
        { x: 6, y: 5.5 },
        { x: 6, y: 6 },
        { x: 0, y: 6 },
      ],
    };
    const passes = vcarvePasses([glyph], {
      tool: VBIT_90,
      maxDepthMm: 2,
      depthPerPassMm: 2,
      resolutionMm: 0.5,
    });
    const fingerOrder = passes
      .flatMap((pass) => {
        const xy = passXy(pass);
        if (xy.length === 0) return [];
        // Coverage of the square's δ ladder ends at its right edge (x = 6),
        // so finger detail rings live entirely at x > 6.
        const inFinger = xy.every((point) => point.x >= 6.01);
        if (!inFinger) return [];
        const maxY = Math.max(...xy.map((point) => point.y));
        return [maxY <= 1.2 ? 'A' : 'B'];
      })
      .join('');
    expect(fingerOrder.length).toBeGreaterThan(4);
    expect(fingerOrder).toMatch(/^(A+B+|B+A+)$/);
  });

  it('flags pass-limited planning for a 1° bit at 0.05 mm depth (#584)', () => {
    // The clamp footprint wants 0.05·tan(0.5°) ≈ 0.00044 mm rings — below
    // the 0.001 mm emission grid. The pitch floors at 0.002 mm, the clamp is
    // honoured, and planning reports pass-limited instead of silently capping.
    const narrow: CncTool = {
      id: 'v1',
      name: '1° engraver',
      kind: 'v-bit',
      diameterMm: 6,
      tipAngleDeg: 1,
    };
    const ladder = vcarveLadderPasses([square(0, 2)], {
      tool: narrow,
      maxDepthMm: 0.05,
      depthPerPassMm: 0.05,
      resolutionMm: 0.5,
    });
    expect(ladder.passLimited).toBe(true);
    expect(ladder.passes.length).toBeGreaterThan(0);
    for (const z of passDepths(ladder.passes)) {
      expect(z).toBeGreaterThanOrEqual(-0.05 - 1e-9);
      expect(z).toBeLessThan(0);
    }
  });

  it('certifies constant-clearance acute-bit detail at emitted precision', () => {
    const acute: CncTool = {
      id: 'v5',
      name: '5° engraver',
      kind: 'v-bit',
      diameterMm: 6,
      tipAngleDeg: 5,
    };
    const ladder = vcarveLadderPasses([band(0.15, 10)], {
      tool: acute,
      maxDepthMm: 2,
      depthPerPassMm: 2,
      resolutionMm: 0.5,
    });
    // The coarse pitch is representable, and one boundary segment certifies
    // the constant-clearance center span across its full emitted chord.
    expect(2 * Math.tan((2.5 * Math.PI) / 180)).toBeGreaterThan(0.002);
    expect(ladder.passLimited).toBe(false);
    const profiles = ladder.passes.filter((pass) => pass.kind === 'path3d');
    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles.flatMap((pass) => pass.points).length).toBeLessThan(5_000);
    for (const profile of profiles) {
      for (let index = 1; index < profile.points.length - 1; index += 1) {
        const previous = profile.points[index - 1];
        const point = profile.points[index];
        if (previous === undefined || point === undefined) continue;
        expect(`${point.x.toFixed(3)},${point.y.toFixed(3)}`).not.toBe(
          `${previous.x.toFixed(3)},${previous.y.toFixed(3)}`,
        );
      }
    }
    for (const z of passDepths(ladder.passes)) {
      expect(z).toBeGreaterThanOrEqual(-2);
      expect(z).toBeLessThan(0);
    }
    expect(Math.min(...passDepths(ladder.passes))).toBeCloseTo(
      -0.05 / Math.tan((2.5 * Math.PI) / 180),
      2,
    );
  });

  it('property: detail passes never cut deeper than the band half-width (100 seeds)', () => {
    // A 90° bit's groove over a band of width w is w/2 deep at the centerline;
    // cutting deeper than the artwork asks for would gouge the workpiece.
    const width = fc.double({ min: 0.15, max: 0.95, noNaN: true });
    fc.assert(
      fc.property(width, (w) => {
        const options = { tool: VBIT_90, maxDepthMm: 5, depthPerPassMm: 5, resolutionMm: 1 };
        const a = vcarvePasses([band(w, 8)], options);
        const b = vcarvePasses([band(w, 8)], options);
        expect(a).toEqual(b);
        for (const z of passDepths(a)) {
          expect(z).toBeGreaterThanOrEqual(-(w / 2) - 1e-9);
          expect(z).toBeLessThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
