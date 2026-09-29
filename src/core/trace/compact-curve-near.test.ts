import { describe, expect, it } from 'vitest';
import type { CurveSubpath, PathSegment, Polyline, Vec2 } from '../scene';
import { evaluateCubic, type CubicBezier } from '../geometry/cubic-fit';
import { CurveContactCache, type SampleProximity } from './compact-curve-contacts';
import { linePiece, pieceMeetsItself, piecesMeet, type CurvePiece } from './compact-curve-meet';
import { sampleCompactCurve } from './compact-curve-fit';
import {
  ringMeetsItself,
  ringMeetsNeighbours,
  ringPiecesSteps,
  ringsMeet,
  type RingPieces,
} from './compact-curve-pieces';
import { ContourContactCache } from './contour-contact-cache';
import { intersectingContourLoopsSteps } from './contour-intersections';
import { curvedTraceRing } from './trace-curves';
import { runTraceSteps } from './trace-steps';

// ADR-531 amendment 1: the curve guard skips rings whose samples the sample
// test found apart (compact-curve-contacts.ts). The skip must be exact: these
// tests check the premises it rests on, rings whose curves meet between their
// samples, and the guard's verdicts with and without the skip on random rings.

type Random = () => number;

function random(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const ring = (curve: CurveSubpath): Polyline => curvedTraceRing(sampleCompactCurve(curve), curve);
const piecesOf = (polyline: Polyline, id: number): RingPieces | null =>
  runTraceSteps(ringPiecesSteps(polyline, id));
const sorted = (values: Iterable<number>): number[] => [...values].sort((a, b) => a - b);
const line = (x: number, y: number): PathSegment => ({ kind: 'line', to: { x, y } });

// One repair round's sample test, then the guard with and without its word.
function guardRound(rings: ReadonlyArray<Polyline>) {
  const contacts = new ContourContactCache();
  const samples = runTraceSteps(intersectingContourLoopsSteps(rings, contacts));
  const proximity: SampleProximity = {
    near: (a, b) => contacts.samplesNear(a, b),
    nearItself: (points) => contacts.samplesNearItself(points),
  };
  const skipping = runTraceSteps(new CurveContactCache(proximity).conflictsSteps(rings));
  const full = runTraceSteps(new CurveContactCache().conflictsSteps(rings));
  return { contacts, samples: sorted(samples), skipping: sorted(skipping), full: sorted(full) };
}

// A cubic from `from` to `to`: gentle, bulging, looped (controls crossed far
// past the ends) or cusp-like (controls folded back across the chord).
function randomCubic(next: Random, from: Vec2, to: Vec2, size: number): PathSegment {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const span = Math.max(Math.hypot(dx, dy), size * 0.5);
  const angle = next() * 2 * Math.PI;
  const [nx, ny] = [Math.cos(angle), Math.sin(angle)];
  const at = (p: Vec2, ax: number, ay: number): Vec2 => ({ x: p.x + ax, y: p.y + ay });
  const kind = next();
  const h = (next() - 0.5) * 2 * span;
  if (kind < 0.35) {
    const s = () => (next() - 0.5) * span * 0.6;
    return cubic(at(from, dx / 3 + s(), dy / 3 + s()), at(to, -dx / 3 + s(), -dy / 3 + s()), to);
  }
  if (kind < 0.55) return cubic(at(from, nx * h, ny * h), at(to, nx * h, ny * h), to);
  if (kind < 0.8) {
    const k = 0.3 + next() * 1.4;
    return cubic(
      at(to, dx * k + nx * h, dy * k + ny * h),
      at(from, -dx * k + nx * h, -dy * k + ny * h),
      to,
    );
  }
  const fold = (0.3 + next()) * span;
  return cubic(at(to, nx * fold, ny * fold), at(from, nx * fold, ny * fold), to);
}

function cubic(control1: Vec2, control2: Vec2, to: Vec2): PathSegment {
  return { kind: 'cubic', control1, control2, to };
}

// A closed curve of one to seven sides around (cx, cy), some sides lines.
function randomCurve(next: Random, cx: number, cy: number): CurveSubpath {
  const parts = 1 + Math.floor(next() * 7);
  const size = 0.15 + next() * next() * 5;
  const corners = Array.from({ length: parts }, (_, k) => {
    const angle = ((k + next() * 0.8) / parts) * 2 * Math.PI;
    const radius = size * (0.3 + next());
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
  const start = corners[0]!;
  const segments = corners.map((from, k) => {
    const to = corners[k + 1] ?? start;
    return parts > 1 && next() < 0.2 ? line(to.x, to.y) : randomCubic(next, from, to, size);
  });
  return { start, segments, closed: true };
}

function randomRings(next: Random, count: number, field: number): Polyline[] {
  return Array.from({ length: count }, () => {
    const curve = randomCurve(next, next() * field, next() * field);
    // Now and then a ring without a fitted curve: its samples are its edges.
    return next() < 0.1 ? { points: sampleCompactCurve(curve), closed: true } : ring(curve);
  });
}

// The top side of a block: a bump from (0, 0) to (length, 0) whose highest
// point falls between two samples. Returns the bump, the highest sample and
// the curve's highest point, or null when a sample lands on the top.
function bump(
  next: Random,
): { segment: PathSegment; length: number; top: number; peak: number } | null {
  const length = 2 + next() * 8;
  const c1 = { x: length * (0.1 + next() * 0.4), y: 0.1 + next() * 0.4 };
  const c2 = { x: length * (0.5 + next() * 0.4), y: 0.1 + next() * 0.4 };
  const segment = cubic(c1, c2, { x: length, y: 0 });
  const bezier: CubicBezier = { p0: { x: 0, y: 0 }, p1: c1, p2: c2, p3: { x: length, y: 0 } };
  const samples = sampleCompactCurve({ start: bezier.p0, segments: [segment], closed: false });
  const top = Math.max(...samples.map((p) => p.y));
  let peak = -Infinity;
  for (let k = 0; k <= 20000; k += 1) peak = Math.max(peak, evaluateCubic(bezier, k / 20000).y);
  return peak - top > 1e-4 ? { segment, length, top, peak } : null;
}

describe('the premises of skipping pieces the samples keep apart', () => {
  it('cuts no cubic into more pieces than it has sample steps', () => {
    const next = random(7);
    for (let trial = 0; trial < 3000; trial += 1) {
      const from = { x: next() * 10, y: next() * 10 };
      const scale = 0.01 * 10 ** (next() * 4.7);
      const to =
        trial % 10 === 0
          ? from
          : { x: from.x + (next() - 0.5) * scale, y: from.y + (next() - 0.5) * scale };
      const curve: CurveSubpath = {
        start: from,
        segments: [randomCubic(next, from, to, scale)],
        closed: false,
      };
      const steps = sampleCompactCurve(curve).length - 1;
      const pieces = piecesOf(ring(curve), 0);
      expect(pieces?.halved).toBe(false);
      expect(pieces?.count ?? 0).toBeLessThanOrEqual(steps);
    }
  });

  it('keeps every point of a cubic within 0.02 px of the edge of its own sample step', () => {
    const next = random(11);
    for (let trial = 0; trial < 400; trial += 1) {
      const from = { x: next() * 10, y: next() * 10 };
      const scale = 0.05 * 10 ** (next() * 3);
      const to = { x: from.x + (next() - 0.5) * scale, y: from.y + (next() - 0.5) * scale };
      const segment = randomCubic(next, from, to, scale);
      if (segment.kind !== 'cubic') continue;
      const bezier = { p0: from, p1: segment.control1, p2: segment.control2, p3: to };
      const samples = sampleCompactCurve({ start: from, segments: [segment], closed: false });
      const steps = samples.length - 1;
      let worst = 0;
      for (let s = 0; s < steps; s += 1) {
        for (let u = 0; u <= 16; u += 1) {
          const point = evaluateCubic(bezier, (s + u / 16) / steps);
          worst = Math.max(worst, pointSegmentDistance(point, samples[s]!, samples[s + 1]!));
        }
      }
      expect(worst).toBeLessThanOrEqual(0.02 + 1e-9);
    }
  });
});

describe('the curve guard with the sample test’s word on where curves can meet', () => {
  it('still sees two rings whose curves meet between their samples', () => {
    const next = random(3);
    let cases = 0;
    while (cases < 40) {
      const shape = bump(next);
      if (shape === null) continue;
      cases += 1;
      const { segment, length, top } = shape;
      const block = ring({
        start: { x: 0, y: 0 },
        segments: [segment, line(length, -2), line(0, -2), line(0, 0)],
        closed: true,
      });
      // An arch over the block: its roof between the highest sample and the
      // curve's peak crosses the curve and misses every sample edge; 0.06 px
      // above the highest sample it is clear of both.
      for (const [roof, meet] of [
        [top + (shape.peak - top) * (0.1 + next() * 0.8), true],
        [top + 0.06, false],
      ] as const) {
        const L = length;
        const arch: Polyline = {
          closed: true,
          points: [
            [-2, -3],
            [-2, roof + 2],
            [L + 2, roof + 2],
            [L + 2, -3],
            [L + 1, -3],
            [L + 1, roof],
            [-1, roof],
            [-1, -3],
          ].map(([x, y]) => ({ x: x!, y: y! })),
        };
        const round = guardRound([block, arch]);
        expect(round.samples).toEqual([]);
        expect(round.contacts.samplesNear(block.points, arch.points)).toBe(meet);
        expect(round.skipping).toEqual(meet ? [0, 1] : []);
        expect(round.full).toEqual(round.skipping);
      }
    }
  });

  it('still sees a ring whose curve meets itself between samples far along it', () => {
    const next = random(5);
    let cases = 0;
    while (cases < 40) {
      const shape = bump(next);
      if (shape === null) continue;
      cases += 1;
      const { segment, length: L, top } = shape;
      for (const [roof, meet] of [
        [top + (shape.peak - top) * (0.1 + next() * 0.8), true],
        [top + 0.06, false],
      ] as const) {
        // A block whose bump floors a slot; the slot's roof is the same ring
        // six sides further on.
        const slotted = ring({
          start: { x: 0, y: 0 },
          segments: [
            segment,
            line(L, -2),
            line(-3, -2),
            line(-3, roof + 2),
            line(L + 2, roof + 2),
            line(L + 2, roof),
            line(-1, roof),
            line(-1, 0),
            line(0, 0),
          ],
          closed: true,
        });
        const round = guardRound([slotted]);
        expect(round.samples).toEqual([]);
        expect(round.contacts.samplesNearItself(slotted.points)).toBe(meet);
        expect(round.skipping).toEqual(meet ? [0] : []);
        expect(round.full).toEqual(round.skipping);
      }
    }
  });

  it('finds the same conflicts as testing everything, on random rings close together', () => {
    const next = random(2026);
    const seen: Seen = { apart: 0, near: 0, meeting: 0, keptApart: 0, neighbours: 0, halved: 0 };
    for (let trial = 0; trial < 160; trial += 1) {
      const field = [2, 5, 12][trial % 3]!;
      const rings = randomRings(next, 6 + Math.floor(next() * 10), field);
      const round = guardRound(rings);
      expect(round.skipping).toEqual(round.full);
      const pieces = rings.map(piecesOf);
      pieces.forEach((first, a) => {
        if (first === null) return;
        checkRing(first, round.contacts.samplesNearItself(rings[a]!.points), seen);
        pieces.forEach((second, b) => {
          if (b <= a || second === null) return;
          checkPair(
            first,
            second,
            round.contacts.samplesNear(rings[a]!.points, rings[b]!.points),
            seen,
          );
        });
      });
    }
    // Every branch was exercised.
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(10);
  });
});

type Seen = {
  apart: number;
  near: number;
  meeting: number;
  keptApart: number;
  neighbours: number;
  halved: number;
};

// Each skip on its own. ringMeetsNeighbours tests exactly the pieces one and
// two places apart, and where the samples keep a ring apart from itself it
// agrees with the full test.
function checkRing(ring: RingPieces, nearItself: boolean | undefined, seen: Seen): void {
  if (ring.halved) seen.halved += 1;
  if (ring.cubics.length === 0) return;
  const neighbours = ringMeetsNeighbours(ring);
  expect(neighbours).toBe(neighboursMeetByHand(ring));
  if (neighbours) seen.neighbours += 1;
  if (ring.halved || nearItself !== false) return;
  expect(neighbours).toBe(ringMeetsItself(ring));
  seen.keptApart += 1;
}

// Rings the samples keep apart do not meet.
function checkPair(first: RingPieces, second: RingPieces, near: boolean | undefined, seen: Seen) {
  const meet = ringsMeet(first, second);
  if (near === false) expect(meet).toBe(false);
  seen.apart += near === false ? 1 : 0;
  seen.near += near === true ? 1 : 0;
  seen.meeting += meet ? 1 : 0;
}

// ringMeetsNeighbours spelled out: each cubic against itself, and every pair
// of pieces one or two places apart round the ring with a cubic in it, their
// shared joints treated as ringMeetsItself treats them.
function neighboursMeetByHand(ring: RingPieces): boolean {
  const byIndex = new Map<number, { readonly piece: CurvePiece; readonly cubic: boolean }>();
  for (const piece of ring.cubics) byIndex.set(piece.index, { piece, cubic: true });
  const packed = ring.straights;
  for (let at = 0; at < packed.length; at += 5) {
    const piece = linePiece(
      { x: packed[at]!, y: packed[at + 1]! },
      { x: packed[at + 2]!, y: packed[at + 3]! },
    );
    byIndex.set(packed[at + 4]!, { piece, cubic: false });
  }
  if (ring.cubics.some((piece) => pieceMeetsItself(piece))) return true;
  const n = ring.count;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const first = byIndex.get(i)!;
      const second = byIndex.get(j)!;
      if (Math.min(j - i, n - (j - i)) > 2 || (!first.cubic && !second.cubic)) continue;
      if (piecePairMeets(first.piece, second.piece, i, j, ring)) return true;
    }
  }
  return false;
}

function piecePairMeets(
  first: CurvePiece,
  second: CurvePiece,
  i: number,
  j: number,
  ring: RingPieces,
) {
  if (j === i + 1) return piecesMeet(first, second, true);
  if (ring.closed && i === 0 && j === ring.count - 1) return piecesMeet(second, first, true);
  return piecesMeet(first, second, false);
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}
