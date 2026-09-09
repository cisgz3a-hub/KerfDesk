import type { Polyline, Vec2 } from '../scene';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import { closeRingEndpoints } from './centerline/loop-closure';
import { intersectingContourLoopsSteps } from './contour-intersections';
import { ContourMembership } from './contour-membership';
import { ContourContactCache } from './contour-contact-cache';
import { contourBox, visitContourBoxPairsSteps } from './contour-spatial';
import type { TraceSteps } from './trace-steps';

export type ContourRefinement = {
  readonly polyline: Polyline;
  readonly baseline: Polyline;
  readonly refine: (amount: number) => Polyline;
};
export type FinishedContour = ContourRefinement & { readonly source: Polyline };

// These are refinement attempts, not an output-distance floor. Valid small
// positive gaps stay byte-identical, and the earlier geometry remains available.
const REFINEMENT_ATTEMPTS = 12;
const REFINEMENT_REDUCTION = 0.5;

/** Keep a final curve candidate together with the geometry it refines. */
export function contourRefinement(
  points: ReadonlyArray<Vec2>,
  refine: (amount: number) => ReadonlyArray<Vec2>,
): ContourRefinement {
  const closed = (amount: number): Polyline => closeContour(refine(amount));
  return { baseline: closeContour(points), polyline: closed(1), refine: closed };
}

/** Explicit closure for contour fallback paths as well as refined paths. */
export function closeContour(points: ReadonlyArray<Vec2>): Polyline {
  // A one-element input produces a one-element output.
  return closeRingEndpoints([{ points, closed: true }])[0] as Polyline;
}

/** Preserve boundary relationships while retaining valid smoothing unchanged. */
export function* preserveContourTopologySteps(
  contours: ReadonlyArray<FinishedContour>,
): TraceSteps<Polyline[]> {
  const cooperate = yield;
  const current = contours.map((contour) => contour.polyline);
  const attempts = contours.map(() => 0);
  const membership = new ContourMembership();
  const contacts = new ContourContactCache();
  for (;;) {
    const conflicts = yield* intersectingContourLoopsSteps(current, contacts);
    yield* addNestingConflictsSteps(contours, current, conflicts, membership);
    let changed = false;
    for (const index of conflicts) {
      if (cooperate) yield;
      const contour = contours[index];
      const attempt = attempts[index];
      if (contour === undefined || attempt === undefined || attempt > REFINEMENT_ATTEMPTS + 1)
        continue;
      const next = attempt + 1;
      attempts[index] = next;
      current[index] =
        next <= REFINEMENT_ATTEMPTS
          ? contour.refine(REFINEMENT_REDUCTION ** next)
          : next === REFINEMENT_ATTEMPTS + 1
            ? contour.baseline
            : contour.source;
      changed = true;
    }
    // Each conflicting contour moves only toward an earlier representation.
    // Once source boundaries are reached, any inherited source contact is kept.
    if (!changed) return current;
  }
}

function* addNestingConflictsSteps(
  contours: ReadonlyArray<FinishedContour>,
  current: ReadonlyArray<Polyline>,
  conflicts: Set<number>,
  membership: ContourMembership,
): TraceSteps<void> {
  const cooperate = yield;
  const boxes = contours.map((contour, index) => {
    const candidate = current[index] ?? contour.polyline;
    if (
      Math.sign(signedAreaMm2(candidate.points)) !== Math.sign(signedAreaMm2(contour.source.points))
    ) {
      conflicts.add(index);
    }
    return {
      ...contourBox([...contour.source.points, ...candidate.points]),
      source: contour.source,
      candidate,
      index,
    };
  });
  if (cooperate) yield;
  const pairs: [(typeof boxes)[number], (typeof boxes)[number]][] = [];
  yield* visitContourBoxPairsSteps(boxes, (a, b) => pairs.push([a, b]));
  for (const [a, b] of pairs) {
    if (cooperate) yield;
    if (
      (yield* membershipChangedSteps(a.source, b.source, a.candidate, b.candidate, membership)) ||
      (yield* membershipChangedSteps(b.source, a.source, b.candidate, a.candidate, membership))
    ) {
      conflicts.add(a.index);
      conflicts.add(b.index);
    }
  }
}

function* membershipChangedSteps(
  a: Polyline,
  b: Polyline,
  currentA: Polyline,
  currentB: Polyline,
  membership: ContourMembership,
): TraceSteps<boolean> {
  yield;
  const sourcePoint = a.points[0];
  const currentPoint = currentA.points[0];
  return (
    sourcePoint !== undefined &&
    currentPoint !== undefined &&
    (yield* membership.containsSteps(sourcePoint, b.points)) !==
      (yield* membership.containsSteps(currentPoint, currentB.points))
  );
}
