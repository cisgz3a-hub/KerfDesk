// The bounded fallback for a contour loop the area policy has already
// admitted but the finishing tail could not finish (ADR-488). The legacy tail
// simplifies each smoothed ring with the preset's tolerance. A sliver thinner
// than about twice that tolerance (a 1 px diagonal hairline, a white 1 px
// slit, a thresholded anti-aliased line) reduces to its two anchor points and
// the tail returns nothing. The loop used to fall back to the raw mid-crack
// chain at 0.5 px spacing: hundreds of G1 moves for one line.
//
// The fallback still starts from that measured chain, so it never loses the
// stroke, but it simplifies it first. Both caps (the chain's extremes along
// its long axis) and their ring neighbours are pinned, so each side of the
// sliver is simplified on its own and neither end can taper to a point. The
// tolerance steps down from the finishing tolerance in quarter-octave steps
// to 1/16 (the topology repair's floor) and stops at the first polygon that
// keeps the chain's area. The polygon is kept only when it is a real saving
// (at most half the chain's points); otherwise, and for a chain with no such
// step, the loop keeps the raw chain exactly as before. Loops the tail
// finished never reach this code.

import type { Vec2 } from '../scene';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import { simplifyChain } from './centerline';
import { contourRefinement, type ContourRefinement } from './contour-topology';

/** Fewest points a finished closed ring may have (contour-trace's MIN_LOOP_POINTS). */
export const ADMITTED_LOOP_MIN_POINTS = 3;
// Quarter-octave steps from the finishing tolerance down to 1/16 of it, the
// same floor as contour-topology's four halvings. A 1 px hairline has no
// tolerance between "collapses" and "keeps every stair", so whole halvings
// can step straight over the one that works.
const LADDER_STEPS = 16;
const STEPS_PER_HALVING = 4;
// A band needs two points at each end; three distinct points is a wedge that
// tapers one end of the stroke to nothing.
const MIN_DISTINCT_VERTICES = 4;
// The polygon replaces the raw chain only when it has at most this share of
// its points.
const RETRY_MAX_POINT_SHARE = 0.5;
// A chain shorter than this (16 px of crack boundary at 0.5 px spacing) is a
// speck or dot, already a handful of moves. Cutting its corners saves a few
// points and costs area fidelity (owl and hummingbird Smooth: about 1000
// dots, -0.0005 IoU), so it keeps its raw chain.
const MIN_SIMPLIFIED_CHAIN_POINTS = 32;
// A step is accepted only when its polygon keeps the measured chain's area
// within this share, so the stroke keeps its width on average. Collapse-prone
// slivers are sawtooth or beaded crack chains, so their compact polygons
// swing by up to about a quarter of the area; a tighter bound (2%) rejects
// every compact polygon on exactly these lines.
const AREA_TOLERANCE = 0.15;

function farthestIndex(chain: ReadonlyArray<Vec2>, from: number): number {
  const origin = chain[from];
  let best = from;
  let bestDistance = -1;
  chain.forEach((point, index) => {
    const distance = origin === undefined ? 0 : Math.hypot(point.x - origin.x, point.y - origin.y);
    if (distance > bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/** The chain's two caps (its extremes along the long axis) and their ring
 *  neighbours: pinned, they keep both ends of a sliver at full width. */
export function capAnchors(chain: ReadonlyArray<Vec2>): ReadonlySet<Vec2> {
  const n = chain.length;
  const first = farthestIndex(chain, 0);
  const second = farthestIndex(chain, first);
  const anchors = new Set<Vec2>();
  for (const cap of [first, second]) {
    for (const offset of [-1, 0, 1]) {
      const point = chain[(cap + offset + n) % n];
      if (point !== undefined) anchors.add(point);
    }
  }
  return anchors;
}

function distinctVertices(points: ReadonlyArray<Vec2>): number {
  return new Set(points.map((point) => `${point.x},${point.y}`)).size;
}

/** The tolerance at which the measured chain first keeps an area-true band,
 *  or undefined when no step gives a worthwhile one. */
export function admittedLoopEpsilon(
  chain: ReadonlyArray<Vec2>,
  epsilonPx: number,
  anchors: ReadonlySet<Vec2> = capAnchors(chain),
): number | undefined {
  const chainArea = Math.abs(signedAreaMm2(chain));
  if (chain.length < MIN_SIMPLIFIED_CHAIN_POINTS || !(chainArea > 0)) return undefined;
  for (let step = 0; step <= LADDER_STEPS; step += 1) {
    const epsilon = epsilonPx * 2 ** (-step / STEPS_PER_HALVING);
    const simplified = simplifyChain(chain, true, epsilon, anchors);
    if (
      distinctVertices(simplified) >= MIN_DISTINCT_VERTICES &&
      Math.abs(Math.abs(signedAreaMm2(simplified)) - chainArea) <= AREA_TOLERANCE * chainArea
    ) {
      return simplified.length <= chain.length * RETRY_MAX_POINT_SHARE ? epsilon : undefined;
    }
  }
  return undefined;
}

/** Keep an admitted loop whose finishing tail returned nothing: the measured
 *  chain, simplified when that is a real saving. Topology repair refines it
 *  toward the raw chain, then the source, like any other loop. */
export function admittedLoopFallback(
  crack: ReadonlyArray<Vec2>,
  epsilonPx: number,
): ContourRefinement {
  const anchors = capAnchors(crack);
  const epsilon = admittedLoopEpsilon(crack, epsilonPx, anchors);
  if (epsilon === undefined) return contourRefinement(crack, () => crack);
  return contourRefinement(crack, (amount) =>
    simplifyChain(crack, true, epsilon * amount, anchors),
  );
}
