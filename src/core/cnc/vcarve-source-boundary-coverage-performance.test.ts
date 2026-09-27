import { log } from 'node:console';
import { env } from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vec3 } from '../geometry/vec3';
import type { CncPass } from '../job';
import type { Polyline } from '../scene';
import * as precision from './cnc-output-precision';
import * as radial from './radial-envelope';
import { measureVCarveSourceBoundaryCoverage } from './vcarve-source-boundary-coverage';
import {
  denseBoundaryCoverageFixture,
  referenceVCarveSourceBoundaryCoverage,
} from './vcarve-source-boundary-coverage-reference.test-support';

afterEach(() => vi.restoreAllMocks());

const envelope: radial.RadialEnvelope = { tanHalf: 1, tipRadiusMm: 0.1, outerRadiusMm: 3 };
const square: Polyline[] = [
  {
    closed: true,
    points: [
      { x: -2, y: -2 },
      { x: 2, y: -2 },
      { x: 2, y: 2 },
      { x: -2, y: 2 },
      { x: -2, y: -2 },
    ],
  },
];

function path(points: ReadonlyArray<Vec3>): CncPass {
  return { kind: 'path3d', points, closed: false };
}

describe('source-boundary coverage preparation', () => {
  it('prepares radii and chord geometry once per unique cutting chord', () => {
    const fixture = denseBoundaryCoverageFixture(64, 64);
    const radii = vi.spyOn(radial, 'radialEnvelopeSweepRadiiMm');
    const roots = vi.spyOn(Math, 'sqrt');
    const coordinate = vi.spyOn(precision, 'representedCncCoordinateMm');
    const measured = measureVCarveSourceBoundaryCoverage(
      fixture.source,
      fixture.passes,
      fixture.envelope,
    );
    expect(measured.sampleCount).toBe(128);
    expect(measured.maxSampledResidualMm).toBeGreaterThan(0);
    expect(radii).toHaveBeenCalledTimes(64);
    expect(roots.mock.calls.length).toBeLessThanOrEqual(64);
    expect(coordinate).toHaveBeenCalledTimes(65 * 3);
  });

  it.each([0, 1, 64, 4096, 5000])(
    'matches the original dense measurement with %s chords',
    (count) => {
      // Larger cases cross the witness/chord budget, retaining its exact
      // omitted-witness disclosure as well as the measured distance.
      const fixture = denseBoundaryCoverageFixture(count);
      expect(
        measureVCarveSourceBoundaryCoverage(fixture.source, fixture.passes, fixture.envelope),
      ).toEqual(
        referenceVCarveSourceBoundaryCoverage(fixture.source, fixture.passes, fixture.envelope),
      );
    },
  );

  it('rejects distant sweeps before the scalar distance without changing the result', () => {
    const fixture = denseBoundaryCoverageFixture(256, 64);
    const hypot = vi.spyOn(Math, 'hypot');
    const original = referenceVCarveSourceBoundaryCoverage(
      fixture.source,
      fixture.passes,
      fixture.envelope,
    );
    const oldSolves = hypot.mock.calls.length;
    hypot.mockClear();
    expect(
      measureVCarveSourceBoundaryCoverage(fixture.source, fixture.passes, fixture.envelope),
    ).toEqual(original);
    expect(hypot.mock.calls.length).toBeLessThan(oldSolves / 2);
    if (env['LF_COVERAGE_BENCH'] === '1') {
      log(
        JSON.stringify({ scalarHypotCalls: { before: oldSolves, after: hypot.mock.calls.length } }),
      );
    }
  });

  it('retains duplicate-chord replacement order, zero-depth rounding and vertical sweeps', () => {
    const a = { x: -1.00049, y: 0, z: -0.0004 };
    const b = { x: 1.00049, y: 0, z: -0.7004 };
    const c = { x: 1.00049, y: 0, z: 0.1 };
    const passes = [
      path([a, b, c, c]),
      path([b, a]),
      path([
        { ...a, z: -0.00049 },
        { ...b, z: -0.70049 },
      ]),
      { kind: 'contour' as const, closed: true, polyline: square[0]!.points, zMm: -3 },
      path([]),
      path([a]),
    ];
    for (const tipRadiusMm of [0, 0.1, 0.8]) {
      for (const tanHalf of [0.25, 1, 3]) {
        const law = { ...envelope, tipRadiusMm, tanHalf };
        expect(measureVCarveSourceBoundaryCoverage(square, passes, law)).toEqual(
          referenceVCarveSourceBoundaryCoverage(square, passes, law),
        );
      }
    }
  });

  it('retains degenerate, empty and non-finite input results', () => {
    const origins = [
      [],
      [{ closed: false, points: [] }],
      [{ closed: true, points: [{ x: 0, y: 0 }] }],
      square,
    ];
    for (const source of origins) {
      for (const coordinate of [0, -0, Number.NaN, Infinity, -Infinity, 1e20]) {
        const passes = [
          path([
            { x: coordinate, y: 1, z: -0.2 },
            { x: coordinate, y: 2, z: -0.6 },
          ]),
        ];
        expect(measureVCarveSourceBoundaryCoverage(source, passes, envelope)).toEqual(
          referenceVCarveSourceBoundaryCoverage(source, passes, envelope),
        );
      }
    }
  });

  it('preserves boundary equality and rounding-scale separation with a preceding close sweep', () => {
    for (const scale of [0.001, 1, 1000, 1e6]) {
      const source = square.map((loop) => ({
        ...loop,
        points: loop.points.map((point) => ({ x: point.x * scale, y: point.y * scale })),
      }));
      for (const offset of [0, Number.EPSILON * scale, 0.001 * scale]) {
        const passes = [
          path([
            { x: -scale, y: 0, z: -0.1 * scale },
            { x: scale, y: 0, z: -0.2 * scale },
          ]),
          path([
            { x: -2 * scale - offset, y: -2 * scale, z: -0.1 * scale },
            { x: -2 * scale - offset, y: 2 * scale, z: -0.2 * scale },
          ]),
        ];
        for (const tanHalf of [0, 1, 10, Number.NaN, Infinity, -1]) {
          const law = { ...envelope, tanHalf, tipRadiusMm: 0.1 * scale };
          expect(measureVCarveSourceBoundaryCoverage(source, passes, law)).toEqual(
            referenceVCarveSourceBoundaryCoverage(source, passes, law),
          );
        }
      }
    }
  });

  it('keeps scalar overflow evidence after a preceding ordinary sweep', () => {
    // Isolate the sweep math from GRBL's narrower coordinate parser: a finite
    // representation can overflow its subtraction, squared length or denominator.
    vi.spyOn(precision, 'representedCncCoordinateMm').mockImplementation((value) => value);
    for (const magnitude of [1e200, 1e308]) {
      const passes = [
        path([
          { x: -0.5, y: 0, z: -0.1 },
          { x: 0.5, y: 0, z: -0.1 },
        ]),
        path([
          { x: -magnitude, y: magnitude, z: -1 },
          { x: magnitude, y: magnitude, z: -1 },
        ]),
      ];
      const original = referenceVCarveSourceBoundaryCoverage(square, passes, envelope);
      expect(measureVCarveSourceBoundaryCoverage(square, passes, envelope)).toEqual(original);
      if (magnitude === 1e308) expect(original.maxSampledResidualMm).toBeNull();
    }
  });

  it('matches the scalar oracle across deterministic varied source boundaries and depths', () => {
    let seed = 827134;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let trial = 0; trial < 100; trial += 1) {
      const source: Polyline[] = Array.from({ length: 1 + (trial % 3) }, () => ({
        closed: true,
        points: Array.from({ length: 3 + (trial % 17) }, () => ({
          x: next() * 12 - 6,
          y: next() * 12 - 6,
        })),
      }));
      const points = Array.from({ length: trial % 37 }, () => ({
        x: next() * 12 - 6,
        y: next() * 12 - 6,
        z: next() * 4 - 3,
      }));
      const passes = [path(points), path([...points].reverse())];
      const law = { ...envelope, tanHalf: next() * 3, tipRadiusMm: next() * 0.5 };
      expect(measureVCarveSourceBoundaryCoverage(source, passes, law)).toEqual(
        referenceVCarveSourceBoundaryCoverage(source, passes, law),
      );
    }
  });
});

it.skipIf(env['LF_COVERAGE_BENCH'] !== '1')('reports matched dense coverage timing', () => {
  const fixture = denseBoundaryCoverageFixture();
  const measure = (run: typeof measureVCarveSourceBoundaryCoverage) => {
    const start = performance.now();
    const result = run(fixture.source, fixture.passes, fixture.envelope);
    return { ms: performance.now() - start, result };
  };
  const baseline: number[] = [];
  const candidate: number[] = [];
  for (let index = 0; index < 7; index += 1) {
    const before = measure(referenceVCarveSourceBoundaryCoverage);
    const after = measure(measureVCarveSourceBoundaryCoverage);
    expect(after.result).toEqual(before.result);
    if (index >= 2) {
      baseline.push(before.ms);
      candidate.push(after.ms);
    }
  }
  log(JSON.stringify({ fixture: '4096 chords, 128 witnesses', baseline, candidate }));
});
