import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildOffsetLadder } from '../geometry/offset-ladder';
import type { CncTool, Polyline } from '../scene';
import { zPassDepths } from './depth-passes';
import { vcarveLadderPasses, vcarvePasses, vcarveResolutionMm } from './vcarve-ladder';

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

// δ rings stay constant-Z contours; detail rings are path3d since the
// junction blend (ADR-281 Amendment 2) — helpers read both.
function passXy(
  pass: ReturnType<typeof vcarvePasses>[number],
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  if (pass.kind === 'contour') return pass.polyline;
  if (pass.kind === 'path3d') return pass.points;
  return [];
}

function contourDepths(passes: ReturnType<typeof vcarvePasses>): number[] {
  return passes.map((pass) => {
    if (pass.kind === 'contour') return pass.zMm;
    if (pass.kind === 'path3d') return Math.min(...pass.points.map((point) => point.z));
    return Number.NaN;
  });
}

function contourRegionOrder(passes: ReturnType<typeof vcarvePasses>): string {
  return passes
    .map((pass) => {
      const xy = passXy(pass);
      if (xy.length === 0) return '?';
      return Math.max(...xy.map((point) => point.x)) < 10 ? 'L' : 'R';
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
    // Rings 1 and 2 of the δ ladder (corner-detail passes from ADR-281 may
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
    // Corner-wedge DETAIL rings keep the junction blend under a ramp (#592
    // blocker 2): they emit as path3d without lateralFeed and interleave with
    // the δ rings' ramp/cleanup pairs, which must still walk in strict pairs.
    const rampAndCleanup = passes.filter(
      (pass) => !(pass.kind === 'path3d' && pass.lateralFeed === undefined),
    );
    expect(rampAndCleanup.length).toBeGreaterThan(0);
    expect(rampAndCleanup.length % 2).toBe(0);
    for (let index = 0; index < rampAndCleanup.length; index += 2) {
      const ramp = rampAndCleanup[index];
      const cleanup = rampAndCleanup[index + 1];
      expect(ramp).toMatchObject({ kind: 'path3d', lateralFeed: 'plunge' });
      expect(cleanup).toMatchObject({ kind: 'contour', closed: true });
      if (ramp?.kind !== 'path3d' || cleanup?.kind !== 'contour') continue;
      expect(ramp.points[0]?.z).toBe(0);
      expect(ramp.points.at(-1)?.z).toBeCloseTo(cleanup.zMm, 9);
    }
  });

  it('keeps the junction blend on detail rings when a ramp is configured (#592)', () => {
    // A thin band is pure detail: with a ramp configured its rings must STILL
    // carry the per-vertex blend profile instead of reverting to constant
    // pitch depths — enabling the ramp must not bring the seam back.
    const thin: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 0.5 },
        { x: 0, y: 0.5 },
      ],
    };
    const passes = vcarvePasses([thin], {
      tool: VBIT_90,
      maxDepthMm: 2,
      depthPerPassMm: 2,
      resolutionMm: 0.5,
      rampAngleDeg: 3,
    });
    const blended = passes.filter(
      (pass) => pass.kind === 'path3d' && pass.lateralFeed === undefined,
    );
    expect(blended.length).toBeGreaterThan(0);
    for (const pass of blended) {
      if (pass.kind !== 'path3d') continue;
      const distinctZ = new Set(pass.points.map((point) => point.z));
      expect(distinctZ.size).toBeGreaterThan(1);
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
    // Detail rings became per-vertex path3d passes with the junction blend;
    // their completeness is pinned by the thin-detail suites. This test pins
    // that the region reorder loses/duplicates no δ ring (all contour passes
    // are δ rings).
    const expected = [...ringKeys(ladder.rings, resolutionMm)].sort();
    const actual = vcarvePasses(contours, {
      tool: VBIT_90,
      maxDepthMm,
      depthPerPassMm,
      resolutionMm,
    })
      .flatMap((pass) => (pass.kind === 'contour' ? [passKey(pass.zMm, pass.polyline)] : []))
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
