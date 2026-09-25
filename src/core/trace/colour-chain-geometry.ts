// Finishing one colour-layer boundary chain into curves (ADR-402). Own design:
// the chain's mid-crack points, moved to their measured sub-pixel edge
// (colour-chain-offsets.ts), are smoothed with a light Taubin filter while
// persistent lattice corners and junctions stay pinned, then fitted with
// least-squares cubics (geometry/cubic-fit.ts); exactly straight cubics are
// written as lines. Every chain is finished ONCE and read by both regions it
// separates, forward or reversed, so neighbours share the identical curve.
//
// Pure core: deterministic, no clock, no random, no I/O.

import type { CubicPathSegment, LinePathSegment, Vec2 } from '../scene';
import { fitCubicsThroughPoints, type CubicBezier } from './fit-cubics';
import type { BoundaryChain } from './colour-regions';
import { cornerPoint, crackPoint, vertexAt } from './colour-chain-offsets';

// Least-squares cubic tolerance in working pixels (the contour lane's 0.35 px
// measured-loop tolerance, slightly tighter because two regions read it).
const FIT_TOLERANCE_PX = 0.3;
const TAUBIN_PASSES = 3;
const TAUBIN_LAMBDA = 0.5;
const TAUBIN_MU = -0.53;
// Persistent-corner test on the lattice (the tree-wide 60 degree convention):
// the turn between chords 2 cracks back and forward must reach 60 degrees and
// persist (>= 50 degrees) with 6-crack chords; a 1-px notch does not persist.
const CORNER_NEAR_SPAN = 2;
const CORNER_FAR_SPAN = 6;
const CORNER_NEAR_COS = Math.cos((60 * Math.PI) / 180);
const CORNER_FAR_COS = Math.cos((50 * Math.PI) / 180);
// A fitted cubic whose control points lie this close to its chord is a line.
const STRAIGHT_CONTROL_PX = 0.01;
const SAMPLE_STEP_PX = 1.5;

export type ChainSegment = LinePathSegment | CubicPathSegment;

export type ChainGeometry = {
  readonly start: Vec2;
  readonly segments: ReadonlyArray<ChainSegment>;
  /** Polyline samples from start to end inclusive. */
  readonly samples: ReadonlyArray<Vec2>;
};

export function finishChain(
  chain: BoundaryChain,
  offsets: Float64Array,
  junctions: ReadonlyMap<number, Vec2>,
  width: number,
): ChainGeometry {
  const cracks = chain.dirs.length;
  const corners = chainCorners(chain);
  const dense: Vec2[] = [];
  const pins = new Set<Vec2>();
  const pushPinned = (point: Vec2): void => {
    dense.push(point);
    pins.add(point);
  };
  if (!chain.closed) pushPinned(junctionPoint(chain, 0, junctions, width));
  for (let i = 0; i < cracks; i += 1) {
    if (chain.closed && corners.has(i)) pushPinned(cornerPoint(chain, i, offsets));
    dense.push(crackPoint(chain, i, offsets[i] as number));
    const next = i + 1;
    if (!chain.closed && next < cracks && corners.has(next)) {
      pushPinned(cornerPoint(chain, next, offsets));
    }
  }
  if (!chain.closed) pushPinned(junctionPoint(chain, chain.xs.length - 1, junctions, width));
  const smoothed = taubinSmooth(dense, chain.closed, pins);
  const cubics = fitCubicsThroughPoints(smoothed, chain.closed, pins, FIT_TOLERANCE_PX);
  return chainGeometryFromCubics(cubics, smoothed);
}

/** The same chain walked the other way (the region on its right reads it). */
export function reversedGeometry(g: ChainGeometry): ChainGeometry {
  const ends: Vec2[] = [g.start, ...g.segments.map((segment) => segment.to)];
  const segments: ChainSegment[] = [];
  for (let i = g.segments.length - 1; i >= 0; i -= 1) {
    const segment = g.segments[i] as ChainSegment;
    const to = ends[i] as Vec2;
    segments.push(
      segment.kind === 'cubic'
        ? { kind: 'cubic', control1: segment.control2, control2: segment.control1, to }
        : { kind: 'line', to },
    );
  }
  return {
    start: ends[ends.length - 1] as Vec2,
    segments,
    samples: [...g.samples].reverse(),
  };
}

function junctionPoint(
  chain: BoundaryChain,
  index: number,
  junctions: ReadonlyMap<number, Vec2>,
  width: number,
): Vec2 {
  const x = chain.xs[index] as number;
  const y = chain.ys[index] as number;
  return junctions.get(y * (width + 1) + x) ?? { x, y };
}

/** Crack-vertex indices where the lattice outline turns persistently. */
function chainCorners(chain: BoundaryChain): Set<number> {
  const cracks = chain.dirs.length;
  const candidates = cornerCandidates(chain);
  candidates.sort((a, b) => a.score - b.score || a.k - b.k);
  const corners = new Set<number>();
  for (const candidate of candidates) {
    let clear = true;
    for (let d = -CORNER_NEAR_SPAN; d <= CORNER_NEAR_SPAN && clear; d += 1) {
      const j = chain.closed ? (candidate.k + d + cracks) % cracks : candidate.k + d;
      if (d !== 0 && corners.has(j)) clear = false;
    }
    if (clear) corners.add(candidate.k);
  }
  return corners;
}

function cornerCandidates(chain: BoundaryChain): { readonly k: number; readonly score: number }[] {
  const cracks = chain.dirs.length;
  const candidates: { readonly k: number; readonly score: number }[] = [];
  for (let k = chain.closed ? 0 : 1; k < cracks; k += 1) {
    const reach = chain.closed ? Math.floor(cracks / 4) : Math.min(k, cracks - k);
    if (reach < CORNER_NEAR_SPAN || turnCosine(chain, k, CORNER_NEAR_SPAN) > CORNER_NEAR_COS) {
      continue;
    }
    const far = turnCosine(chain, k, Math.min(CORNER_FAR_SPAN, reach));
    if (far <= CORNER_FAR_COS) candidates.push({ k, score: far });
  }
  return candidates;
}

function turnCosine(chain: BoundaryChain, k: number, span: number): number {
  const v = vertexAt(chain, k);
  const back = vertexAt(chain, k - span);
  const ahead = vertexAt(chain, k + span);
  const inX = v.x - back.x;
  const inY = v.y - back.y;
  const outX = ahead.x - v.x;
  const outY = ahead.y - v.y;
  const lengths = Math.hypot(inX, inY) * Math.hypot(outX, outY);
  return lengths <= 0 ? 1 : (inX * outX + inY * outY) / lengths;
}

function taubinSmooth(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  pins: ReadonlySet<Vec2>,
): Vec2[] {
  let current = [...points];
  const n = current.length;
  if (n < 3) return current;
  const step = (factor: number): void => {
    const next: Vec2[] = new Array<Vec2>(n);
    for (let i = 0; i < n; i += 1) {
      const p = current[i] as Vec2;
      const prev = closed ? current[(i - 1 + n) % n] : current[i - 1];
      const after = closed ? current[(i + 1) % n] : current[i + 1];
      if (prev === undefined || after === undefined || pins.has(points[i] as Vec2)) {
        next[i] = p;
        continue;
      }
      next[i] = {
        x: p.x + factor * ((prev.x + after.x) / 2 - p.x),
        y: p.y + factor * ((prev.y + after.y) / 2 - p.y),
      };
    }
    current = next;
  };
  for (let pass = 0; pass < TAUBIN_PASSES; pass += 1) {
    step(TAUBIN_LAMBDA);
    step(TAUBIN_MU);
  }
  // Pinned points keep their identity so the fitter can find them.
  return current.map((point, i) => (pins.has(points[i] as Vec2) ? (points[i] as Vec2) : point));
}

function chainGeometryFromCubics(
  cubics: ReadonlyArray<CubicBezier>,
  fallback: ReadonlyArray<Vec2>,
): ChainGeometry {
  const head = cubics[0];
  if (head === undefined) {
    const start = fallback[0] ?? { x: 0, y: 0 };
    const segments = fallback.slice(1).map((to) => ({ kind: 'line' as const, to }));
    return { start, segments, samples: [...fallback] };
  }
  const segments: ChainSegment[] = [];
  const samples: Vec2[] = [head.p0];
  for (const cubic of cubics) {
    if (isStraight(cubic)) {
      segments.push({ kind: 'line', to: cubic.p3 });
      samples.push(cubic.p3);
      continue;
    }
    segments.push({ kind: 'cubic', control1: cubic.p1, control2: cubic.p2, to: cubic.p3 });
    const steps = Math.max(2, Math.ceil(cubicHullLength(cubic) / SAMPLE_STEP_PX));
    for (let s = 1; s <= steps; s += 1) samples.push(evaluateCubic(cubic, s / steps));
    samples[samples.length - 1] = cubic.p3;
  }
  return { start: head.p0, segments, samples };
}

function isStraight(c: CubicBezier): boolean {
  const dx = c.p3.x - c.p0.x;
  const dy = c.p3.y - c.p0.y;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-9) return false;
  const within = (p: Vec2): boolean => {
    const along = ((p.x - c.p0.x) * dx + (p.y - c.p0.y) * dy) / len;
    const across = Math.abs((p.x - c.p0.x) * dy - (p.y - c.p0.y) * dx) / len;
    return (
      across <= STRAIGHT_CONTROL_PX &&
      along >= -STRAIGHT_CONTROL_PX &&
      along <= len + STRAIGHT_CONTROL_PX
    );
  };
  return within(c.p1) && within(c.p2);
}

function cubicHullLength(c: CubicBezier): number {
  return (
    Math.hypot(c.p1.x - c.p0.x, c.p1.y - c.p0.y) +
    Math.hypot(c.p2.x - c.p1.x, c.p2.y - c.p1.y) +
    Math.hypot(c.p3.x - c.p2.x, c.p3.y - c.p2.y)
  );
}

function evaluateCubic(c: CubicBezier, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y,
  };
}
