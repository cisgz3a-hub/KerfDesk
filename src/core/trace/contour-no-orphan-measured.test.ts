// The no-orphan invariant (ADR-458 amendment 1) on the MEASURED finishing
// tail: an anti-aliased nest whose cracks carry sub-pixel information, so each
// loop is finished by the compact cubic fit (fitLoopTail, ADR-440) rather than
// the legacy simplify tail. A coarse fit tolerance must not lose a loop, and
// a fit that collapses to nothing must fall back to the crack boundary.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import type { InkMask } from './centerline';
import { traceBoundaryLoops } from './contour-boundary';
import { contourPolylinesFromMask } from './contour-trace';
import type * as CompactCurveFit from './compact-curve-fit';
import type { CrackSubPixelField } from './saddle-connectivity';

const fit = vi.hoisted(() => ({ collapse: false, calls: 0 }));

vi.mock('./compact-curve-fit', async (importOriginal) => {
  const actual = await importOriginal<typeof CompactCurveFit>();
  return {
    ...actual,
    fitCompactRing: (...args: Parameters<typeof actual.fitCompactRing>) => {
      fit.calls += 1;
      return fit.collapse ? null : actual.fitCompactRing(...args);
    },
  };
});

// A ring (radii 44-50 px) around a disc (radius 36 px), off the pixel grid and
// anti-aliased: three loops (outer, hole, island), each long enough for the
// measured tail.
const SIZE = 120;
const CENTRE = { x: 60.3, y: 59.7 };
const THRESHOLD = 128;

function inkDepth(x: number, y: number): number {
  const r = Math.hypot(x + 0.5 - CENTRE.x, y + 0.5 - CENTRE.y);
  return Math.max(36 - r, Math.min(r - 44, 50 - r));
}

function lumaAt(x: number, y: number): number {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return 255;
  return 255 * (1 - Math.min(1, Math.max(0, inkDepth(x, y) + 0.5)));
}

const crackField: CrackSubPixelField = { lumaAt, thresholdAt: () => THRESHOLD };

function nestMask(): InkMask {
  const ink = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) ink[y * SIZE + x] = lumaAt(x, y) < THRESHOLD ? 1 : 0;
  }
  return { width: SIZE, height: SIZE, ink };
}

function signedArea(points: ReadonlyArray<Vec2>): number {
  let twice = 0;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length] as Vec2;
    twice += a.x * b.y - b.x * a.y;
  });
  return twice / 2;
}

const ring = (polyline: Polyline): ReadonlyArray<Vec2> => polyline.points.slice(0, -1);

// Distance of a ring's mean vertex radius from the nest centre, which orders
// the three concentric loops by depth.
function meanRadius(points: ReadonlyArray<Vec2>): number {
  const sum = points.reduce((total, p) => total + Math.hypot(p.x - CENTRE.x, p.y - CENTRE.y), 0);
  return sum / points.length;
}

function finish(fitToleranceScale: number): Polyline[] {
  return contourPolylinesFromMask(nestMask(), {
    minAreaPx: 0,
    epsilonPx: 0.45,
    flattenStrength: 0,
    fitToleranceScale,
    crackField,
    turnPolicy: 'auto',
  });
}

describe('no-orphan invariant on the measured (sub-pixel) finishing tail', () => {
  beforeEach(() => {
    fit.collapse = false;
    fit.calls = 0;
  });

  const loops = traceBoundaryLoops(nestMask());

  it('traces the nest as an outer, a hole and an island', () => {
    const byRadius = [...loops].sort((a, b) => meanRadius(b.points) - meanRadius(a.points));
    expect(byRadius.map((loop) => Math.round(meanRadius(loop.points)))).toEqual([50, 44, 36]);
    const outerSign = Math.sign(byRadius[0]?.area ?? 0);
    expect(byRadius.map((loop) => Math.sign(loop.area))).toEqual([
      outerSign,
      -outerSign,
      outerSign,
    ]);
  });

  for (const [label, scale, collapse] of [
    ['a fine fit', 1, false],
    ['a coarse fit', 400, false],
    ['a fit that collapses to nothing', 1, true],
  ] as const) {
    it(`keeps one ring per loop, with orientation and depth, under ${label}`, () => {
      fit.collapse = collapse;
      const out = finish(scale);
      // The measured tail ran: it is the contour lane's only cubic fit.
      expect(fit.calls).toBeGreaterThanOrEqual(loops.length);
      expect(out).toHaveLength(loops.length);
      out.forEach((polyline, index) => {
        expect(polyline.closed).toBe(true);
        expect(polyline.points.length).toBeGreaterThanOrEqual(4);
        expect(Math.sign(signedArea(ring(polyline))), `${index}`).toBe(
          Math.sign(loops[index]?.area ?? 0),
        );
        // Each ring stays on its own loop, so depth (and with it the fill
        // parity) is the source loop's: outer 50 px, hole 44, island 36.
        const source = meanRadius(loops[index]?.points ?? []);
        expect(Math.abs(meanRadius(ring(polyline)) - source)).toBeLessThan(1.5);
      });
    });
  }
});
