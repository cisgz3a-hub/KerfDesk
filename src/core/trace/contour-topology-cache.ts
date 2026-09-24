import type { Polyline, Vec2 } from '../scene';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import { contourBox, type ContourBox } from './contour-bounds';
import type { ContourMembership } from './contour-membership';
import type { TraceSteps } from './trace-steps';

type BoundaryMeasurement = { readonly sign: number; readonly bounds: ContourBox };

/** Immutable boundaries are shared by the contact, membership and measurement caches. */
export class ContourMeasurements {
  private readonly values = new WeakMap<ReadonlyArray<Vec2>, BoundaryMeasurement>();

  get(points: ReadonlyArray<Vec2>): BoundaryMeasurement {
    let value = this.values.get(points);
    if (value === undefined) {
      value = { sign: Math.sign(signedAreaMm2(points)), bounds: contourBox(points) };
      this.values.set(points, value);
    }
    return value;
  }
}

export type TopologyBoundary = {
  readonly source: Polyline;
  readonly candidate: Polyline;
  readonly index: number;
};
type PairRelation = {
  a?: number;
  b?: number;
  changed?: boolean;
  forward?: boolean;
  reverse?: boolean;
};

/**
 * Owned by one topology repair, with stable contour indexes and immutable sources.
 * Retain only the latest candidate relation for at most 8,192 owner pairs. Further
 * pairs are still checked exactly; deep nesting cannot grow this cache quadratically.
 * First-seen admission keeps useful entries through repeated ordered full scans.
 */
export class ContourNestingRelations {
  private readonly pairs = new Map<number, Map<number, PairRelation>>();
  private readonly boundaries = new WeakMap<ReadonlyArray<Vec2>, number>();
  private pairCount = 0;
  private boundaryCount = 0;

  constructor(private readonly maximumPairs = 8192) {}

  *changedSteps(
    first: TopologyBoundary,
    second: TopologyBoundary,
    membership: ContourMembership,
  ): TraceSteps<boolean> {
    yield;
    const forward = first.index < second.index;
    const [a, b] = forward ? [first, second] : [second, first];
    const value = this.pair(a.index, b.index);
    const candidateA = this.boundaryId(a.candidate.points);
    const candidateB = this.boundaryId(b.candidate.points);
    if (value.a === candidateA && value.b === candidateB && value.changed !== undefined)
      return value.changed;
    // Canonical owner keys must not reorder the visitor's directional comparisons.
    const changed =
      (yield* directionSteps(first, second, forward ? 'forward' : 'reverse', value, membership)) ||
      (yield* directionSteps(second, first, forward ? 'reverse' : 'forward', value, membership));
    // A cancelled comparison may retain completed source queries, never a partial result.
    value.a = candidateA;
    value.b = candidateB;
    value.changed = changed;
    return changed;
  }

  private boundaryId(points: ReadonlyArray<Vec2>): number {
    let id = this.boundaries.get(points);
    if (id === undefined) {
      id = this.boundaryCount++;
      this.boundaries.set(points, id);
    }
    // Numeric identities avoid retaining superseded, potentially dense point arrays.
    return id;
  }

  private pair(a: number, b: number): PairRelation {
    let peers = this.pairs.get(a);
    const previous = peers?.get(b);
    if (previous !== undefined) return previous;
    const value: PairRelation = {};
    if (this.pairCount < this.maximumPairs) {
      if (peers === undefined) {
        peers = new Map();
        this.pairs.set(a, peers);
      }
      peers.set(b, value);
      this.pairCount += 1;
    }
    return value;
  }
}

function* directionSteps(
  a: TopologyBoundary,
  b: TopologyBoundary,
  key: 'forward' | 'reverse',
  value: PairRelation,
  membership: ContourMembership,
): TraceSteps<boolean> {
  yield;
  const sourcePoint = a.source.points[0];
  const candidatePoint = a.candidate.points[0];
  if (sourcePoint === undefined || candidatePoint === undefined) return false;
  let before = value[key];
  if (before === undefined) {
    before = yield* membership.containsSteps(sourcePoint, b.source.points);
    value[key] = before;
  }
  return before !== (yield* membership.containsSteps(candidatePoint, b.candidate.points));
}
