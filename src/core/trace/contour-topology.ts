import type { Polyline, Vec2 } from '../scene';
import { closeRingEndpoints } from './centerline/loop-closure';
import { intersectingContourLoopsSteps } from './contour-intersections';
import { ContourMembership } from './contour-membership';
import { ContourContactCache } from './contour-contact-cache';
import { unionContourBoxes } from './contour-bounds';
import { ContourPairCache } from './contour-pair-cache';
import { ContourMeasurements, ContourNestingRelations } from './contour-topology-cache';
import type { TraceSteps } from './trace-steps';

export type ContourRefinement = {
  readonly polyline: Polyline;
  readonly baseline: Polyline;
  readonly refine: (amount: number) => Polyline;
};
export type FinishedContour = ContourRefinement & {
  readonly source: Polyline;
  /** The same boundary finished without its rebuilt corners. Tried once, on
   *  the contour's first conflict, before its smoothing is backed off. */
  readonly withoutRebuiltCorners?: () => ContourRefinement;
};

// These are refinement attempts, not an output-distance floor. Valid small
// positive gaps stay byte-identical, and the earlier geometry remains available.
// Four halvings reach 1/16 of the finishing tolerance (0.35 px becomes about
// 0.02 px), below the boundary's own noise. Further halvings barely move the
// curve, yet each one costs a full check of the drawing.
const REFINEMENT_ATTEMPTS = 4;
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
  const repair: TopologyRepair = { current, attempts, finishes: [...contours] };
  const membership = new ContourMembership();
  const contacts = new ContourContactCache();
  const measurements = new ContourMeasurements();
  const relations = new ContourNestingRelations();
  const nestingPairs = new ContourPairCache();
  for (;;) {
    const conflicts = yield* intersectingContourLoopsSteps(current, contacts);
    yield* addNestingConflictsSteps(contours, current, conflicts, {
      membership,
      measurements,
      relations,
      nestingPairs,
    });
    let changed = false;
    for (const index of conflicts) {
      if (cooperate) yield;
      const contour = contours[index];
      if (contour !== undefined && backOffContour(contour, index, repair)) changed = true;
    }
    // Each conflicting contour moves only toward its source boundary: the
    // finish without rebuilt corners, weaker refinements, the smoothed
    // baseline, then the source. Once source boundaries are reached, any
    // inherited source contact is kept.
    if (!changed) return current;
  }
}

type TopologyRepair = {
  readonly current: Polyline[];
  /** The finish each contour is backing off: its own, or the one without
   *  rebuilt corners once that has been swapped in. */
  readonly finishes: ContourRefinement[];
  readonly attempts: number[];
};

/** Move one conflicting contour a step toward its source boundary. False once
 *  it is already there. A step that returns the geometry the contour already
 *  has is passed over: it cannot resolve the conflict, and each round costs a
 *  check of the whole drawing. The tracer's refinements are always new, so
 *  this only shortens callers with fixed steps, like the laser commit guard. */
function backOffContour(contour: FinishedContour, index: number, repair: TopologyRepair): boolean {
  const finish = repair.finishes[index] ?? contour;
  const attempt = repair.attempts[index] ?? 0;
  if (attempt > REFINEMENT_ATTEMPTS + 1) return false;
  // Retry this contour alone without its rebuilt corners, keeping full
  // smoothing. Stepping the smoothing down first would strip it from both
  // contours of the pair and, after the halvings, from each whole outline.
  if (finish === contour && contour.withoutRebuiltCorners !== undefined) {
    const alternate = contour.withoutRebuiltCorners();
    repair.finishes[index] = alternate;
    repair.current[index] = alternate.polyline;
    return true;
  }
  const current = repair.current[index];
  for (let next = attempt + 1; next <= REFINEMENT_ATTEMPTS + 2; next += 1) {
    repair.attempts[index] = next;
    const step = backOffStep(contour, finish, next);
    if (step !== current) {
      repair.current[index] = step;
      return true;
    }
  }
  return false;
}

// Weaker refinements, then the smoothed baseline, then the source boundary.
function backOffStep(contour: FinishedContour, finish: ContourRefinement, step: number): Polyline {
  if (step <= REFINEMENT_ATTEMPTS) return finish.refine(REFINEMENT_REDUCTION ** step);
  return step === REFINEMENT_ATTEMPTS + 1 ? finish.baseline : contour.source;
}

/** What one topology repair keeps between its rounds. */
type NestingCaches = {
  readonly membership: ContourMembership;
  readonly measurements: ContourMeasurements;
  readonly relations: ContourNestingRelations;
  readonly nestingPairs: ContourPairCache;
};

function* addNestingConflictsSteps(
  contours: ReadonlyArray<FinishedContour>,
  current: ReadonlyArray<Polyline>,
  conflicts: Set<number>,
  { membership, measurements, relations, nestingPairs }: NestingCaches,
): TraceSteps<void> {
  const cooperate = yield;
  const boxes = contours.map((contour, index) => {
    const candidate = current[index] ?? contour.polyline;
    const sourceMeasurement = measurements.get(contour.source.points);
    const candidateMeasurement = measurements.get(candidate.points);
    if (candidateMeasurement.sign !== sourceMeasurement.sign) {
      conflicts.add(index);
    }
    return {
      ...unionContourBoxes([sourceMeasurement.bounds, candidateMeasurement.bounds]),
      source: contour.source,
      candidate,
      index,
    };
  });
  if (cooperate) yield;
  // A box changes only with its candidate boundary, so that is its key.
  const pairs = yield* nestingPairs.pairsSteps(boxes, (box) => box.candidate.points);
  for (const { first: a, second: b, slot } of pairs) {
    if (cooperate) yield;
    // An unchanged pair keeps the verdict its unchanged boundaries gave.
    let changed = nestingPairs.recall(slot) as boolean | undefined;
    if (changed === undefined) {
      changed = yield* relations.changedSteps(a, b, membership);
      nestingPairs.remember(slot, changed);
    }
    if (changed) {
      conflicts.add(a.index);
      conflicts.add(b.index);
    }
  }
}
