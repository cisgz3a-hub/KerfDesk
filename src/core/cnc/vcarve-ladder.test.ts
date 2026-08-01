import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildOffsetLadder } from '../geometry/offset-ladder';
import type { CncTool, Polyline } from '../scene';
import { zPassDepths } from './depth-passes';
import { vcarveLadderPasses, vcarvePasses, vcarveResolutionMm } from './vcarve-ladder';
import { THIN_DETAIL_RESOLUTION_MM, vcarveThinDetailRings } from './vcarve-thin-detail';

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

function contourDepths(passes: ReturnType<typeof vcarvePasses>): number[] {
  return passes.map((pass) => (pass.kind === 'contour' ? pass.zMm : Number.NaN));
}

function contourRegionOrder(passes: ReturnType<typeof vcarvePasses>): string {
  return passes
    .map((pass) => {
      if (pass.kind !== 'contour') return '?';
      return Math.max(...pass.polyline.map((point) => point.x)) < 10 ? 'L' : 'R';
    })
    .join('');
}

function passKey(zMm: number, polyline: ReadonlyArray<{ x: number; y: number }>): string {
  return `${zMm.toFixed(9)}:${polyline.map((point) => `${point.x},${point.y}`).join(';')}`;
}

describe('vcarvePasses', () => {
  it('follows the depth law: ring k at inset k·δ cuts z = −inset/tan(θ/2)', () => {
    // 90° bit → tan(45°) = 1 → depth equals inset exactly.
    const passes = vcarvePasses([square(0, 20)], {
      tool: VBIT_90,
      maxDepthMm: 10,
      depthPerPassMm: 10,
      resolutionMm: 0.5,
    });
    const depths = contourDepths(passes);
    // Rings 1 and 2 of the δ ladder (corner-detail passes from ADR-279 may
    // sit shallower — they follow the same law at the fine pitch).
    expect(depths.some((z) => Math.abs(z + 0.5) < 1e-9)).toBe(true);
    expect(depths.some((z) => Math.abs(z + 1.0) < 1e-9)).toBe(true);
    // The 6 mm 90° bit's cutting flank ends at (6/2)/tan(45°) = 3 mm — the
    // ladder must stop there, not at the 20 mm square's 10 mm medial axis.
    const deepest = Math.min(...depths);
    expect(deepest).toBeCloseTo(-3, 9);
  });

  it('clamps the ladder to the bit cone height — deeper V cuts do not physically exist', () => {
    // maxDepth 10 with a 6 mm 90° bit: cone height is 3 mm; rings past a
    // 3 mm inset flood the floor at -3, and nothing cuts deeper (the shank
    // above the flank would rub, and the modeled groove width would be a
    // lie past the bit diameter).
    const passes = vcarvePasses([square(0, 20)], {
      tool: VBIT_90,
      maxDepthMm: 10,
      depthPerPassMm: 10,
      resolutionMm: 0.5,
    });
    const depths = contourDepths(passes);
    expect(depths.every((z) => z >= -3 - 1e-9)).toBe(true);
    expect(depths.filter((z) => Math.abs(z + 3) < 1e-9).length).toBeGreaterThan(3);
  });

  it('clamps to maxDepth and floods the flat floor at δ spacing', () => {
    const passes = vcarvePasses([square(0, 20)], {
      tool: VBIT_90,
      maxDepthMm: 1,
      depthPerPassMm: 10,
      resolutionMm: 0.5,
    });
    const depths = contourDepths(passes);
    expect(Math.min(...depths)).toBeCloseTo(-1, 9);
    // Rings past the 1 mm clamp inset all sit at the floor — several of them.
    expect(depths.filter((z) => Math.abs(z + 1) < 1e-9).length).toBeGreaterThan(3);
    expect(depths.every((z) => z >= -1 - 1e-9 && z < 0)).toBe(true);
  });

  it('splits deep rings through depthPerPassMm (stepped plunges)', () => {
    const passes = vcarvePasses([square(0, 20)], {
      tool: VBIT_90,
      maxDepthMm: 10,
      depthPerPassMm: 1.5,
      resolutionMm: 2, // ring 1 at −2: deeper than one pass allows
    });
    const depths = contourDepths(passes);
    // tan(π/4) carries float error (0.999…), so match with tolerance.
    expect(depths.some((z) => Math.abs(z + 1.5) < 1e-9)).toBe(true);
    expect(depths.some((z) => Math.abs(z + 2) < 1e-9)).toBe(true);
  });

  it('replaces configured stepped plunges with emission-accurate ramps and cleanup laps', () => {
    const passes = vcarvePasses([square(0, 20)], {
      tool: VBIT_90,
      maxDepthMm: 1,
      depthPerPassMm: 0.25,
      resolutionMm: 0.5,
      rampAngleDeg: 3,
    });
    expect(passes.length).toBeGreaterThan(0);
    expect(passes.length % 2).toBe(0);
    for (let index = 0; index < passes.length; index += 2) {
      const ramp = passes[index];
      const cleanup = passes[index + 1];
      expect(ramp).toMatchObject({ kind: 'path3d', lateralFeed: 'plunge' });
      expect(cleanup).toMatchObject({ kind: 'contour', closed: true });
      if (ramp?.kind !== 'path3d' || cleanup?.kind !== 'contour') continue;
      expect(ramp.points[0]?.z).toBe(0);
      expect(ramp.points.at(-1)?.z).toBeCloseTo(cleanup.zMm, 9);
    }
  });

  it('uses the complete legacy ladder and reports an advisory when ramp planning fails', () => {
    const options = {
      tool: VBIT_90,
      maxDepthMm: 1,
      depthPerPassMm: 0.25,
      resolutionMm: 0.5,
    };
    const legacy = vcarveLadderPasses([square(0, 20)], options);
    const fallback = vcarveLadderPasses([square(0, 20)], {
      ...options,
      rampAngleDeg: Number.NaN,
    });
    expect(fallback.passes).toEqual(legacy.passes);
    expect(fallback.passes.length).toBeGreaterThan(0);
    expect(fallback.entryIssue).toContain('positive and finite');
  });

  it('keeps every ring inside the source region (holes respected)', () => {
    const outer = square(0, 30);
    const hole = square(10, 10);
    const passes = vcarvePasses([outer, hole], {
      tool: VBIT_90,
      maxDepthMm: 5,
      depthPerPassMm: 5,
      resolutionMm: 0.5,
    });
    expect(passes.length).toBeGreaterThan(0);
    for (const pass of passes) {
      if (pass.kind !== 'contour') continue;
      for (const p of pass.polyline) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.x).toBeLessThanOrEqual(30 + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1e-6);
        expect(p.y).toBeLessThanOrEqual(30 + 1e-6);
      }
    }
  });

  it('finishes every ring of one disjoint region before travelling to the next', () => {
    const passes = vcarvePasses([square(0, 6), square(20, 6)], {
      tool: VBIT_90,
      maxDepthMm: 3,
      depthPerPassMm: 3,
      resolutionMm: 0.5,
    });

    expect(contourRegionOrder(passes)).toMatch(/^L+R+$/);
  });

  it('keeps a hole and its outer boundary together before the next disjoint region', () => {
    const outer = square(0, 8);
    const hole = square(2, 4);
    const separate = square(20, 8);
    const passes = vcarvePasses([outer, hole, separate], {
      tool: VBIT_90,
      maxDepthMm: 2,
      depthPerPassMm: 2,
      resolutionMm: 0.5,
    });

    expect(contourRegionOrder(passes)).toMatch(/^L+R+$/);
  });

  it('reorders without losing or duplicating any contour/depth pass', () => {
    const contours = [square(0, 8), square(20, 8)];
    const resolutionMm = 0.5;
    const maxDepthMm = 1;
    const depthPerPassMm = 0.4;
    const ringKeys = (
      rings: ReadonlyArray<ReadonlyArray<Polyline>>,
      pitchMm: number,
    ): ReadonlyArray<string> =>
      rings.flatMap((ring, step) => {
        const ringDepthMm = Math.min((step + 1) * pitchMm, maxDepthMm);
        return ring.flatMap((polyline) =>
          zPassDepths(ringDepthMm, depthPerPassMm).map((zMm) =>
            passKey(zMm, closeRing(polyline).points),
          ),
        );
      });
    const ladder = buildOffsetLadder(contours, 64, (step) => (step + 1) * resolutionMm);
    // ADR-279: the corner/thin detail rings are part of the reorder contract.
    const detail = vcarveThinDetailRings(contours, ladder.rings[0] ?? [], resolutionMm);
    const expected = [
      ...ringKeys(ladder.rings, resolutionMm),
      ...ringKeys(detail.rings, THIN_DETAIL_RESOLUTION_MM),
    ].sort();
    const actual = vcarvePasses(contours, {
      tool: VBIT_90,
      maxDepthMm,
      depthPerPassMm,
      resolutionMm,
    })
      .map((pass) => {
        if (pass.kind !== 'contour') throw new Error('expected contour pass');
        return passKey(pass.zMm, pass.polyline);
      })
      .sort();

    expect(actual).toEqual(expected);
  });

  it('returns nothing for open paths or non-positive depth', () => {
    const open: Polyline = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    };
    const options = { tool: VBIT_90, maxDepthMm: 2, depthPerPassMm: 2, resolutionMm: 0.5 };
    expect(vcarvePasses([open], options)).toEqual([]);
    expect(vcarvePasses([square(0, 10)], { ...options, maxDepthMm: 0 })).toEqual([]);
  });

  it.each([undefined, 0.5, 179.5, Number.NaN])(
    'does not invent a 60-degree cone for invalid angle %s',
    (tipAngleDeg) => {
      const { tipAngleDeg: _validAngle, ...baseTool } = VBIT_90;
      const tool: CncTool = {
        ...baseTool,
        ...(tipAngleDeg === undefined ? {} : { tipAngleDeg }),
      };
      expect(
        vcarvePasses([square(0, 10)], {
          tool,
          maxDepthMm: 2,
          depthPerPassMm: 1,
          resolutionMm: 0.5,
        }),
      ).toEqual([]);
    },
  );

  it('preserves the advisory-only legacy output for a non-V-bit selection', () => {
    const wrongKind: CncTool = {
      id: 'end-mill',
      name: '3 mm end mill',
      kind: 'end-mill',
      diameterMm: 3,
    };
    expect(
      vcarvePasses([square(0, 10)], {
        tool: wrongKind,
        maxDepthMm: 2,
        depthPerPassMm: 1,
        resolutionMm: 0.5,
      }).length,
    ).toBeGreaterThan(0);
  });

  it('property: depths always in [−maxDepth, 0) and byte-deterministic (100 seeds)', () => {
    const size = fc.integer({ min: 4, max: 40 });
    const maxDepth = fc.integer({ min: 1, max: 8 });
    fc.assert(
      fc.property(size, maxDepth, (s, d) => {
        const options = {
          tool: VBIT_90,
          maxDepthMm: d,
          depthPerPassMm: d,
          resolutionMm: 0.5,
        };
        const a = vcarvePasses([square(5, s)], options);
        const b = vcarvePasses([square(5, s)], options);
        expect(a).toEqual(b);
        for (const z of contourDepths(a)) {
          expect(z).toBeLessThan(0);
          expect(z).toBeGreaterThanOrEqual(-d - 1e-9);
        }
      }),
      { numRuns: 100 },
    );
  });
});

function closeRing(polyline: Polyline): Polyline {
  const first = polyline.points[0];
  const last = polyline.points[polyline.points.length - 1];
  return first === undefined || last === undefined || (first.x === last.x && first.y === last.y)
    ? polyline
    : { ...polyline, points: [...polyline.points, first] };
}

describe('vcarveResolutionMm', () => {
  it('auto = diameter/8 with a 0.1 mm floor; explicit setting wins', () => {
    expect(vcarveResolutionMm(0, 6.35)).toBeCloseTo(6.35 / 8, 9);
    expect(vcarveResolutionMm(0, 0.4)).toBe(0.1);
    expect(vcarveResolutionMm(0.3, 6.35)).toBe(0.3);
    expect(vcarveResolutionMm(0.02, 6.35)).toBe(0.1);
  });
});

// ADR-279: strokes narrower than 2·δ used to vanish from the carve entirely —
// the first coarse inset already consumed them, so a thin script stroke
// contributed no rings while the rest of the glyph cut. The thin-detail stage
// must carve them with a fine-pitch ladder instead of dropping them.
describe('vcarvePasses — thin detail (ADR-279)', () => {
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
    const depths = contourDepths(passes);
    // Depth law: detail rings walk toward the band's centerline; the deepest
    // must approach half-width/tan(45°) = 0.25 without ever exceeding it.
    expect(Math.min(...depths)).toBeLessThanOrEqual(-0.15);
    expect(Math.min(...depths)).toBeGreaterThanOrEqual(-0.25 - 1e-9);
    for (const pass of passes) {
      if (pass.kind !== 'contour') continue;
      for (const p of pass.polyline) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.x).toBeLessThanOrEqual(10 + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1e-6);
        expect(p.y).toBeLessThanOrEqual(0.5 + 1e-6);
      }
    }
  });

  it('detail passes respect the maxDepth clamp', () => {
    const passes = vcarvePasses([band(0.5, 10)], {
      tool: VBIT_90,
      maxDepthMm: 0.1,
      depthPerPassMm: 0.1,
      resolutionMm: 0.5,
    });
    expect(passes.length).toBeGreaterThan(0);
    for (const z of contourDepths(passes)) {
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
    expect(contourRegionOrder(passes)).toMatch(/^L+R+$/);
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
        if (pass.kind !== 'contour') return [];
        // Coverage of the square's δ ladder ends at its right edge (x = 6),
        // so finger detail rings live entirely at x > 6.
        const inFinger = pass.polyline.every((point) => point.x >= 6.01);
        if (!inFinger) return [];
        const maxY = Math.max(...pass.polyline.map((point) => point.y));
        return [maxY <= 1.2 ? 'A' : 'B'];
      })
      .join('');
    expect(fingerOrder.length).toBeGreaterThan(4);
    expect(fingerOrder).toMatch(/^(A+B+|B+A+)$/);
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
        for (const z of contourDepths(a)) {
          expect(z).toBeGreaterThanOrEqual(-(w / 2) - 1e-9);
          expect(z).toBeLessThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
