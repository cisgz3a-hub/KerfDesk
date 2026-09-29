// The crossing guard on the canonical curves (ADR-531).
//
// The contour topology repair tests each finished ring's compatibility
// samples. Since ADR-530 a fitted ring's output is its cubics, and those can
// cross, touch or loop between samples: a hook where a cubic runs past its end
// and turns back, two legs of a spike bending into each other, two outlines
// passing through each other in a lens thinner than the sampling error. This
// check tests the curves themselves: every ring's pieces
// (compact-curve-pieces.ts) against themselves and against the pieces of every
// ring whose box meets its box, each pair of pieces exactly
// (compact-curve-meet.ts).
//
// The repair calls this once per round, and a round changes only the rings it
// backs off. The first round tests every pair of rings; later rounds test only
// the pairs a changed ring is in and keep every other pair's result. Rings are
// found through a box index of the first round, and rings that changed since
// that index was built are matched among themselves; when they become many,
// the index is rebuilt.
//
// Nearly all of this work proves that pieces do not meet, and the sample test
// that runs just before (contour-contact-cache.ts) already knows where they
// cannot: next to its contacts it records whether two rings' sample edges, or
// two edges of one ring that are not neighbours, come within SAMPLES_NEAR_PX.
// A ring's curves meet only where its samples say they might:
// - A fitted ring's samples are sampleCompactCurve's (curvedTraceRing in
//   contour-trace.ts is the only maker of a ring that carries a curve). Each
//   cubic is sampled at even parameter steps, at least cubicFlatnessSteps for
//   0.02 px, so every point of the curve lies within 0.02 px of the edge of
//   its own step; a line is its own edge. A ring without a fitted curve is
//   tested on its own edges.
// - piecesMeet reports a meeting only where the two curves come within 4e-4
//   px: its leaves lie within 1e-4 px of their chords, every point of a chord
//   is within that of its curve, and leaves meet when their chords come
//   within the two flatnesses.
// - So curves of two rings meet only where their sample edges come within
//   2 x 0.02 + 4e-4 = 0.0404 px, and two rings whose samples the sample test
//   found apart are not tested.
// - Within one ring, a cubic is cut into 2^k pieces with 2^k no more than its
//   sample steps (about 3 px of control polygon against at most 1.5 px of it
//   per step), so a piece spans at least one step's parameter, a line piece is
//   one edge, and two pieces in a row contain a whole edge: two of one cubic
//   span two steps, and a piece that ends its segment covers the segment's
//   last step. Two pieces three or more places apart both ways round the ring
//   therefore have a whole edge between them both ways, and they meet only
//   where two edges that are not neighbours come within 0.0404 px. A ring
//   whose samples have no such edges is tested piece by piece against the
//   pieces one and two places away only (ringMeetsNeighbours). A ring of
//   fewer than four pieces had them halved, and a halved line is half an
//   edge, so it is always tested in full.
// Both skips are exact: the conflicts are the same as testing everything.

import type { Polyline, Vec2 } from '../scene';
import { type ContourBox } from './contour-bounds';
import { ContourBoxIndex } from './contour-box-index';
import {
  ringMeetsItself,
  ringMeetsNeighbours,
  ringPiecesSteps,
  ringsMeet,
  type RingPieces,
} from './compact-curve-pieces';
import { traceRingCurve } from './trace-curves';
import type { TraceSteps } from './trace-steps';

/** What the sample test measured (ContourContactCache.samplesNear and
 *  samplesNearItself): false when the samples stay more than SAMPLES_NEAR_PX
 *  apart, undefined when it did not measure them. */
export type SampleProximity = {
  readonly near: (a: ReadonlyArray<Vec2>, b: ReadonlyArray<Vec2>) => boolean | undefined;
  readonly nearItself: (points: ReadonlyArray<Vec2>) => boolean | undefined;
};

type Slot = ContourBox & { readonly slot: number; readonly id: number };
// Two rings, by position, whose curves met when last tested.
type Meeting = { readonly a: number; readonly b: number };

// Rebuild the ring index once more than this share of rings left it.
const REINDEX_SHARE = 1 / 8;

/** Rings whose canonical curves cross or touch, themselves or each other. */
export class CurveContactCache {
  private readonly rings = new WeakMap<Polyline, RingPieces | null>();
  private nextId = 0;
  private current: (RingPieces | null)[] = [];
  private polylines: ReadonlyArray<Polyline> = [];
  private index: ContourBoxIndex<Slot> | null = null;
  private indexedIds: number[] = [];
  private meetings: Meeting[] = [];

  /** `samples`, when given, is what the sample test of the same rounds
   *  measured; rings it found apart are not tested (the header). */
  constructor(private readonly samples?: SampleProximity) {}

  *conflictsSteps(rings: ReadonlyArray<Polyline>): TraceSteps<Set<number>> {
    const cooperate = yield;
    const conflicts = new Set<number>();
    // Nothing fitted (the laser commit guard, source boundaries): the sample
    // test already saw everything.
    if (!rings.some((ring) => traceRingCurve(ring) !== undefined)) return conflicts;
    const previous = this.current;
    const geometries: (RingPieces | null)[] = [];
    const changed: number[] = [];
    this.polylines = rings;
    for (const [slot, polyline] of rings.entries()) {
      if (cooperate) yield;
      const geometry = yield* this.piecesSteps(polyline);
      geometries.push(geometry);
      if (geometry?.id !== previous[slot]?.id) changed.push(slot);
      if (this.meetsItself(geometry, polyline)) conflicts.add(slot);
    }
    this.current = geometries;
    if (this.index === null || previous.length !== geometries.length) {
      yield* this.fullRoundSteps();
    } else {
      yield* this.changedRoundSteps(changed);
    }
    for (const meeting of this.meetings) {
      conflicts.add(meeting.a);
      conflicts.add(meeting.b);
    }
    return conflicts;
  }

  private *piecesSteps(polyline: Polyline): TraceSteps<RingPieces | null> {
    yield;
    let pieces = this.rings.get(polyline);
    if (pieces === undefined) {
      pieces = yield* ringPiecesSteps(polyline, this.nextId);
      this.nextId += 1;
      this.rings.set(polyline, pieces);
    }
    return pieces;
  }

  // Every pair of rings whose boxes meet.
  private *fullRoundSteps(): TraceSteps<void> {
    const cooperate = yield;
    const index = yield* this.reindexSteps();
    this.meetings = [];
    for (const slot of this.slots()) {
      if (cooperate) yield;
      for (const other of index.query(slot)) {
        if (other.slot > slot.slot) this.test(slot.slot, other.slot);
      }
    }
  }

  // Only the pairs a ring changed this round is in; every other pair keeps
  // its result.
  private *changedRoundSteps(changed: ReadonlyArray<number>): TraceSteps<void> {
    const cooperate = yield;
    const ids = this.current.map((geometry) => geometry?.id ?? -1);
    const isChanged = new Set(changed);
    this.meetings = this.meetings.filter((m) => !isChanged.has(m.a) && !isChanged.has(m.b));
    const moved = yield* this.movedSteps();
    const index = this.index as ContourBoxIndex<Slot>;
    // A pair of two rings changed this round is tested once, from the lower.
    const once = (slot: number, other: number): boolean =>
      other !== slot && (!isChanged.has(other) || other > slot);
    for (const slot of changed) {
      if (cooperate) yield;
      const geometry = this.current[slot];
      if (geometry === null || geometry === undefined) continue;
      // Rings still on the index are found there, the others among `moved`.
      for (const other of index.query(geometry)) {
        const onIndex = this.indexedIds[other.slot] === ids[other.slot];
        if (onIndex && once(slot, other.slot)) this.test(slot, other.slot);
      }
      for (const other of moved?.query(geometry) ?? []) {
        if (once(slot, other.slot)) this.test(slot, other.slot);
      }
    }
  }

  // The rings that changed since the index was built, indexed by their
  // current boxes; when they are many, the main index is rebuilt instead (no
  // pair is retested) and there are none.
  private *movedSteps(): TraceSteps<ContourBoxIndex<Slot> | null> {
    yield;
    const offIndex = this.slots().filter((slot) => this.indexedIds[slot.slot] !== slot.id);
    if (offIndex.length > this.current.length * REINDEX_SHARE) {
      yield* this.reindexSteps();
      return null;
    }
    return offIndex.length === 0 ? null : yield* ContourBoxIndex.createSteps(offIndex);
  }

  private *reindexSteps(): TraceSteps<ContourBoxIndex<Slot>> {
    yield;
    const slots = this.slots();
    this.index = yield* ContourBoxIndex.createSteps(slots);
    this.indexedIds = this.current.map((geometry) => geometry?.id ?? -1);
    return this.index;
  }

  private slots(): Slot[] {
    const slots: Slot[] = [];
    this.current.forEach((geometry, slot) => {
      if (geometry === null) return;
      const { minX, minY, maxX, maxY, id } = geometry;
      slots.push({ minX, minY, maxX, maxY, slot, id });
    });
    return slots;
  }

  private test(a: number, b: number): void {
    const first = this.current[a];
    const second = this.current[b];
    if (first === null || first === undefined || second === null || second === undefined) return;
    if (first.cubics.length === 0 && second.cubics.length === 0) return;
    // Rings whose samples stay apart have curves that do (the header).
    const pointsA = (this.polylines[a] as Polyline).points;
    const pointsB = (this.polylines[b] as Polyline).points;
    if (this.samples?.near(pointsA, pointsB) === false) return;
    if (ringsMeet(first, second)) this.meetings.push({ a, b });
  }

  // Whether a ring's curves meet themselves (tested once per ring). Only
  // pieces close along the ring can meet when its samples that are not
  // neighbours stay apart, unless its pieces were halved (the header).
  private meetsItself(geometry: RingPieces | null, polyline: Polyline): boolean {
    if (geometry === null || geometry.cubics.length === 0) return false;
    geometry.meetsItself ??=
      !geometry.halved && this.samples?.nearItself(polyline.points) === false
        ? ringMeetsNeighbours(geometry)
        : ringMeetsItself(geometry);
    return geometry.meetsItself;
  }
}
