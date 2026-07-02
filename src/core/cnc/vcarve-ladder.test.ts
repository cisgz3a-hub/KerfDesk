import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CncTool, Polyline } from '../scene';
import { vcarvePasses, vcarveResolutionMm } from './vcarve-ladder';

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

describe('vcarvePasses', () => {
  it('follows the depth law: ring k at inset k·δ cuts z = −inset/tan(θ/2)', () => {
    // 90° bit → tan(45°) = 1 → depth equals inset exactly.
    const passes = vcarvePasses([square(0, 20)], {
      tool: VBIT_90,
      maxDepthMm: 10,
      depthPerPassMm: 10,
      resolutionMm: 0.5,
    });
    const depths = [...new Set(contourDepths(passes))].sort((a, b) => b - a);
    expect(depths[0]).toBeCloseTo(-0.5, 9);
    expect(depths[1]).toBeCloseTo(-1.0, 9);
    // A 20 mm square's medial axis is 10 mm in: the ladder must reach most
    // of that depth before offsets vanish.
    const deepest = Math.min(...depths);
    expect(deepest).toBeLessThanOrEqual(-9);
    expect(deepest).toBeGreaterThanOrEqual(-10);
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

describe('vcarveResolutionMm', () => {
  it('auto = diameter/8 with a 0.1 mm floor; explicit setting wins', () => {
    expect(vcarveResolutionMm(0, 6.35)).toBeCloseTo(6.35 / 8, 9);
    expect(vcarveResolutionMm(0, 0.4)).toBe(0.1);
    expect(vcarveResolutionMm(0.3, 6.35)).toBe(0.3);
    expect(vcarveResolutionMm(0.02, 6.35)).toBe(0.1);
  });
});
