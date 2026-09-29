// The corner dial's straight legs (contour-corner-leg-runs.ts) reuse the line
// each straightness test fitted. They must be exactly the legs the dial got
// when it measured every run first and fitted each leg afterwards: the same
// counts and the same bits in every field (ADR-530 Amendment 10).

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { hypot2 } from '../geometry/fast-hypot';
import {
  fitLeg,
  LEG_SLOPE_TOLERANCE,
  straightLegs,
  type Leg,
  type LegRunLimits,
  type LegTolerance,
} from './contour-corner-leg-runs';

describe('straight legs', () => {
  it('match a run-then-fit reference bit for bit', () => {
    const chains: ReadonlyArray<{ readonly pts: Vec2[]; readonly scale: number }> = [
      { pts: noisyPolygon(), scale: 1 },
      { pts: digitizedCircle(40), scale: 1 },
      { pts: star(), scale: 2 },
      { pts: digitizedCircle(9), scale: 1 },
    ];
    for (const { pts, scale } of chains) {
      for (const base of [0.2, 0.5]) {
        const tolerance = { base, slope: LEG_SLOPE_TOLERANCE };
        const cap = Math.min(Math.ceil(24 * scale * 1.5), Math.floor(pts.length / 2) - 2);
        const barriers = everyNth(pts.length, 17);
        const limits: LegRunLimits = { cap, maxSkip: 2 * scale, scale, tolerance, barriers };
        const legs = straightLegs(pts, limits);
        expectSameLegs(legs.ahead, referenceLegs(pts, 1, limits));
        expectSameLegs(legs.back, referenceLegs(pts, -1, limits));
      }
    }
  });
});

function expectSameLegs(actual: ReadonlyArray<Leg>, expected: ReadonlyArray<Leg>): void {
  expect(actual).toHaveLength(expected.length);
  const differing = expected.filter((leg, i) => {
    const other = actual[i] as Leg;
    return (Object.keys(leg) as (keyof Leg)[]).some((key) => !Object.is(leg[key], other[key]));
  });
  expect(differing).toEqual([]);
}

// The dial before the reuse: every run measured by the two-pointer scan,
// then each leg fitted from scratch.
function referenceLegs(pts: ReadonlyArray<Vec2>, step: 1 | -1, limits: LegRunLimits): Leg[] {
  const n = pts.length;
  const stops = referenceStops(pts, limits.scale);
  const grace = limits.maxSkip + Math.max(2, Math.round(3 * limits.scale));
  const blocked = (i: number, count: number): boolean => {
    const vertex = step === 1 ? (i + count) % n : (((i - count + 1) % n) + n) % n;
    return limits.barriers[vertex] !== 0 || (count >= grace && stops[vertex] === 1);
  };
  const runs = new Int32Array(n);
  let run = 1;
  for (let k = 0; k < n; k += 1) {
    const i = step === 1 ? k : n - 1 - k;
    run = Math.max(1, Math.min(limits.cap, run - 1));
    for (let c = 1; c < run; c += 1) {
      if (blocked(i, c)) {
        run = c;
        break;
      }
    }
    while (
      run < limits.cap &&
      !blocked(i, run) &&
      (run < 2 || isStraight(pts, i, run + 1, step, limits.tolerance))
    ) {
      run += 1;
    }
    runs[i] = run;
  }
  return Array.from(runs, (count, i) => fitLeg(pts, i, count, step));
}

function isStraight(
  pts: ReadonlyArray<Vec2>,
  i: number,
  count: number,
  step: 1 | -1,
  tolerance: LegTolerance,
): boolean {
  const n = pts.length;
  const at = (k: number): Vec2 => pts[(((i + k * step) % n) + n) % n] as Vec2;
  const leg = fitLeg(pts, i, count, step);
  const first = at(0);
  const last = at(count - 1);
  const allowed = tolerance.base + tolerance.slope * hypot2(last.x - first.x, last.y - first.y);
  for (let k = 0; k < count; k += 1) {
    const p = at(k);
    if (Math.abs((p.x - leg.cx) * -leg.dy + (p.y - leg.cy) * leg.dx) > allowed) return false;
  }
  return true;
}

function referenceStops(pts: ReadonlyArray<Vec2>, scale: number): Uint8Array {
  const n = pts.length;
  const stops = new Uint8Array(n);
  const k = Math.max(2, Math.round(3 * scale));
  if (n < 2 * k + 1) return stops;
  const turns = Array.from(pts, (at, i) => {
    const prev = pts[(i - k + n) % n] as Vec2;
    const next = pts[(i + k) % n] as Vec2;
    const inX = at.x - prev.x;
    const inY = at.y - prev.y;
    const outX = next.x - at.x;
    const outY = next.y - at.y;
    return Math.abs(Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY));
  });
  turns.forEach((turn, i) => {
    const before = turns[(i - 1 + n) % n] as number;
    const after = turns[(i + 1) % n] as number;
    if (turn <= Math.PI / 3 || turn < before || turn < after) return;
    stops[after >= before ? (i + 1) % n : i] = 1;
  });
  return stops;
}

// A rectangle and a slanted edge with seeded ±0.15 px wobble.
function noisyPolygon(): Vec2[] {
  let seed = 7;
  const wobble = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed / 2147483648 - 0.5) * 0.3;
  };
  const corners: Vec2[] = [
    { x: 0, y: 0 },
    { x: 60, y: 0 },
    { x: 60, y: 35 },
    { x: 20, y: 52 },
    { x: 0, y: 35 },
  ];
  const out: Vec2[] = [];
  corners.forEach((a, c) => {
    const b = corners[(c + 1) % corners.length] as Vec2;
    const steps = Math.ceil(hypot2(b.x - a.x, b.y - a.y));
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      out.push({ x: a.x + (b.x - a.x) * t + wobble(), y: a.y + (b.y - a.y) * t + wobble() });
    }
  });
  return out;
}

// Mid-crack points of a digitized disc's boundary, walked in angle order.
function digitizedCircle(radius: number): Vec2[] {
  const out: Vec2[] = [];
  const steps = Math.round(2 * Math.PI * radius * 1.3);
  for (let s = 0; s < steps; s += 1) {
    const a = (2 * Math.PI * s) / steps;
    out.push({
      x: Math.round(radius * Math.cos(a) * 2) / 2,
      y: Math.round(radius * Math.sin(a) * 2) / 2,
    });
  }
  return out.filter((p, i) => {
    const q = out[(i + 1) % out.length] as Vec2;
    return p.x !== q.x || p.y !== q.y;
  });
}

// A five-point star on a doubled grid, as a supersampled chain.
function star(): Vec2[] {
  const out: Vec2[] = [];
  for (let tip = 0; tip < 10; tip += 1) {
    const r0 = tip % 2 === 0 ? 50 : 20;
    const r1 = tip % 2 === 0 ? 20 : 50;
    const a0 = (Math.PI * tip) / 5;
    const a1 = (Math.PI * (tip + 1)) / 5;
    const from = { x: r0 * Math.cos(a0), y: r0 * Math.sin(a0) };
    const to = { x: r1 * Math.cos(a1), y: r1 * Math.sin(a1) };
    const steps = Math.ceil(hypot2(to.x - from.x, to.y - from.y) * 2);
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      out.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    }
  }
  return out;
}

function everyNth(n: number, every: number): Uint8Array {
  const barriers = new Uint8Array(n);
  for (let i = 5; i < n; i += every) barriers[i] = 1;
  return barriers;
}
