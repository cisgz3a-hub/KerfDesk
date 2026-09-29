import type { Polyline, Vec2 } from '../scene';
import { closeRingEndpoints } from './centerline/loop-closure';
import { intersectingContourLoopsSteps, type ContourPairListener } from './contour-intersections';
import { ContourMembership } from './contour-membership';
import { ContourContactCache } from './contour-contact-cache';
import { unionContourBoxes } from './contour-bounds';
import { ContourPairCache } from './contour-pair-cache';
import { ContourMeasurements, ContourNestingRelations } from './contour-topology-cache';
import { CurveContactCache } from './compact-curve-contacts';
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
// A ring that meets at least this many other rings in a round takes its
// baseline without the weaker refinements (ADR-530, Amendment 9). A weaker
// refinement would have to clear every one of those contacts at once, and it
// costs a whole fit of what is usually a large ring. On uniform noise every
// such ring ended at its source anyway.
const CROWDED_PARTNERS = 8;

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
  const contacts = new ContourContactCache();
  const membership = new ContourMembership((points) => contacts.preparedEdges(points));
  const measurements = new ContourMeasurements();
  const relations = new ContourNestingRelations();
  const nestingPairs = new ContourPairCache();
  const curves = new CurveContactCache();
  for (;;) {
    const partners = new RoundPartners();
    const conflicts = yield* intersectingContourLoopsSteps(current, contacts, partners.add);
    // The fitted curves themselves, which can meet between their samples
    // (ADR-531). Rings without a fitted curve are exact in their samples.
    for (const index of yield* curves.conflictsSteps(current, partners.add)) conflicts.add(index);
    yield* addNestingConflictsSteps(
      contours,
      current,
      conflicts,
      { membership, measurements, relations, nestingPairs },
      partners.add,
    );
    let changed = false;
    for (const index of conflicts) {
      if (cooperate) yield;
      const contour = contours[index];
      const crowded = partners.count(index) >= CROWDED_PARTNERS;
      if (contour !== undefined && backOffContour(contour, index, repair, crowded)) changed = true;
    }
    // Each conflicting contour moves only toward its source boundary: the
    // finish without rebuilt corners, weaker refinements (skipped by a ring
    // that meets many others), the smoothed baseline, then the source. Once
    // source boundaries are reached, any inherited source contact is kept.
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
 *  this only shortens callers with fixed steps, like the laser commit guard.
 *  A crowded contour passes over the weaker refinements too. */
function backOffContour(
  contour: FinishedContour,
  index: number,
  repair: TopologyRepair,
  crowded: boolean,
): boolean {
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
  const first = crowded ? Math.max(attempt, REFINEMENT_ATTEMPTS) + 1 : attempt + 1;
  for (let next = first; next <= REFINEMENT_ATTEMPTS + 2; next += 1) {
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

/** The other rings each ring met in one round, by position. */
class RoundPartners {
  private readonly partners = new Map<number, Set<number>>();

  readonly add: ContourPairListener = (a, b) => {
    if (a === b) return;
    this.of(a).add(b);
    this.of(b).add(a);
  };

  count(ring: number): number {
    return this.partners.get(ring)?.size ?? 0;
  }

  private of(ring: number): Set<number> {
    let partners = this.partners.get(ring);
    if (partners === undefined) {
      partners = new Set();
      this.partners.set(ring, partners);
    }
    return partners;
  }
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
  onPair: ContourPairListener,
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
      onPair(a.index, b.index);
    }
  }
}
