// Work budget of the compact contour fit (ADR-405 review): the points it
// projects onto candidate cubics (every Newton pass and curve-to-chain check)
// for one organic-size ring. The first compact fit projected ~92 points per
// ring point here and made contour traces 2.5-3.4x slower than the tail it
// replaced; single pieces are now fitted once, and a merge extension stops
// once it is bound to miss.

import { describe, expect, it, vi } from 'vitest';
import type { CubicBezier } from '../geometry/cubic-fit';
import type { Vec2 } from '../scene';
import type * as CurveFitError from './centerline/curve-fit-error';
import type * as CurveProject from './compact-curve-project';
import { fitCompactRing } from './compact-curve-fit';

const work = { points: 0 };

vi.mock('./centerline/curve-fit-error', async (importOriginal) => {
  const real = await importOriginal<typeof CurveFitError>();
  return {
    ...real,
    orthogonalError: (run: ReadonlyArray<Vec2>, cubic: CubicBezier, u: ReadonlyArray<number>) => {
      work.points += run.length;
      return real.orthogonalError(run, cubic, u);
    },
  };
});

// The span passes run on the allocation-free kernels (a pass that stops
// early still counts its whole span here).
vi.mock('./compact-curve-project', async (importOriginal) => {
  const real = await importOriginal<typeof CurveProject>();
  return {
    ...real,
    projectSpan: (...args: Parameters<typeof CurveProject.projectSpan>) => {
      work.points += args[0].length;
      return real.projectSpan(...args);
    },
    reverseSpan: (...args: Parameters<typeof CurveProject.reverseSpan>) => {
      work.points += args[0].length;
      return real.reverseSpan(...args);
    },
  };
});

// An organic blob: three harmonics of the outline plus 0.25 px of noise.
function blob(n: number): Vec2[] {
  let state = 12345;
  const noise = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    const r =
      180 +
      9 * Math.sin(3 * a) +
      4 * Math.sin(11 * a + 1) +
      1.5 * Math.sin(37 * a) +
      0.25 * noise();
    return { x: 300 + r * Math.cos(a), y: 300 + r * Math.sin(a) };
  });
}

describe('compact contour fit work (ADR-405)', () => {
  it('projects at most 80 points per ring point on an organic ring', () => {
    const ring = blob(1200);
    work.points = 0;
    const curve = fitCompactRing(ring, new Set(), {
      tolerance: 0.25,
      candidateTolerance: 0.14,
      tangentWindow: 2,
    });
    expect(curve?.segments.length ?? 0).toBeGreaterThan(40);
    // Measured: 70.4 (the first compact fit: 91.6).
    expect(work.points / ring.length).toBeLessThanOrEqual(80);
  });
});
