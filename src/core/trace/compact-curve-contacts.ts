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
// Between rounds a ring keeps only its box and its self-test result. Its
// pieces are cut again when a pair test first needs them, and kept from then
// on: the pieces of every ring would be the largest part of the trace's memory
// on dense noise, and after the skips below few rings are tested in pairs.
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
  piecesCurve,
  ringMeetsItself,
  ringMeetsNeighbours,
  ringPiecesSteps,
  ringsMeet,
  straightRingBox,
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

// A ring between rounds: its box, whether it has curved pieces and meets
// itself, and its pieces once a pair test cut them.
type RingSummary = ContourBox & {
  readonly id: number;
  readonly curved: boolean;
  readonly meetsItself: boolean;
  pieces: RingPieces | undefined;
};
type Slot = ContourBox & { readonly slot: number; readonly id: number };
// Two rings, by position, whose curves met when last tested.
type Meeting = { readonly a: number; readonly b: number };

// Rebuild the ring index once more than this share of rings left it.
const REINDEX_SHARE = 1 / 8;

/** Rings whose canonical curves cross or touch, themselves or each other. */
export class CurveContactCache {
  private readonly rings = new WeakMap<Polyline, RingSummary | null>();
  private nextId = 0;
  private current: (RingSummary | null)[] = [];
  private polylines: ReadonlyArray<Polyline> = [];
  private index: ContourBoxIndex<Slot> | null = null;
  private indexedIds: number[] = [];
  private meetings: Meeting[] = [];

  /** `samples`, when given, is what the sample test of the same rounds
   *  measured; rings it found apart are not tested (the header). */
  constructor(private readonly samples?: SampleProximity) {}

  /** `onPair` hears the two rings of each meeting between different rings. */
  *conflictsSteps(
    rings: ReadonlyArray<Polyline>,
    onPair?: (a: number, b: number) => void,
  ): TraceSteps<Set<number>> {
    const cooperate = yield;
    const conflicts = new Set<number>();
    // Nothing fitted (the laser commit guard, source boundaries): the sample
    // test already saw everything.
    if (!rings.some((ring) => traceRingCurve(ring) !== undefined)) return conflicts;
    const previous = this.current;
    const summaries: (RingSummary | null)[] = [];
    const changed: number[] = [];
    this.polylines = rings;
    for (const [slot, polyline] of rings.entries()) {
      if (cooperate) yield;
      const summary = yield* this.summarySteps(polyline);
      summaries.push(summary);
      if (summary?.id !== previous[slot]?.id) {
        changed.push(slot);
        release(previous[slot]);
      }
      if (meetsItself(summary)) conflicts.add(slot);
    }
    this.current = summaries;
    if (this.index === null || previous.length !== summaries.length) {
      yield* this.fullRoundSteps();
    } else {
      yield* this.changedRoundSteps(changed);
    }
    for (const meeting of this.meetings) {
      conflicts.add(meeting.a);
      conflicts.add(meeting.b);
      onPair?.(meeting.a, meeting.b);
    }
    return conflicts;
  }

  // A ring seen for the first time: a fitted one is cut into pieces and
  // tested against itself, and only the result is kept; one cut into its
  // straight edges needs only its box, since straight pieces never meet each
  // other here.
  private *summarySteps(polyline: Polyline): TraceSteps<RingSummary | null> {
    yield;
    let summary = this.rings.get(polyline);
    if (summary === undefined) {
      const id = this.nextId;
      this.nextId += 1;
      if (piecesCurve(polyline) === undefined) {
        const box = straightRingBox(polyline.points);
        summary = box === null ? null : ringSummary(box, id, false, false);
      } else {
        const pieces = yield* ringPiecesSteps(polyline, id);
        summary =
          pieces === null
            ? null
            : ringSummary(pieces, id, pieces.cubics.length > 0, this.selfTest(pieces, polyline));
      }
      this.rings.set(polyline, summary);
    }
    return summary;
  }

  // A ring's pieces for a pair test, cut again the first time.
  private *piecesSteps(summary: RingSummary, polyline: Polyline): TraceSteps<RingPieces> {
    yield;
    if (summary.pieces === undefined) {
      const pieces = yield* ringPiecesSteps(polyline, summary.id);
      summary.pieces = pieces as RingPieces;
    }
    return summary.pieces;
  }

  // Every pair of rings whose boxes meet.
  private *fullRoundSteps(): TraceSteps<void> {
    const cooperate = yield;
    const index = yield* this.reindexSteps();
    this.meetings = [];
    for (const slot of this.slots()) {
      if (cooperate) yield;
      for (const other of index.query(slot)) {
        if (other.slot > slot.slot && this.mayMeet(slot.slot, other.slot)) {
          yield* this.testSteps(slot.slot, other.slot);
        }
      }
    }
  }

  // Only the pairs a ring changed this round is in; every other pair keeps
  // its result.
  private *changedRoundSteps(changed: ReadonlyArray<number>): TraceSteps<void> {
    const cooperate = yield;
    const ids = this.current.map((summary) => summary?.id ?? -1);
    const isChanged = new Set(changed);
    this.meetings = this.meetings.filter((m) => !isChanged.has(m.a) && !isChanged.has(m.b));
    const moved = yield* this.movedSteps();
    const index = this.index as ContourBoxIndex<Slot>;
    // A pair of two rings changed this round is tested once, from the lower.
    const once = (slot: number, other: number): boolean =>
      other !== slot && (!isChanged.has(other) || other > slot);
    const test = (slot: number, other: number): boolean =>
      once(slot, other) && this.mayMeet(slot, other);
    for (const slot of changed) {
      if (cooperate) yield;
      const summary = this.current[slot];
      if (summary === null || summary === undefined) continue;
      // Rings still on the index are found there, the others among `moved`.
      for (const other of index.query(summary)) {
        const onIndex = this.indexedIds[other.slot] === ids[other.slot];
        if (onIndex && test(slot, other.slot)) yield* this.testSteps(slot, other.slot);
      }
      for (const other of moved?.query(summary) ?? []) {
        if (test(slot, other.slot)) yield* this.testSteps(slot, other.slot);
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
    this.indexedIds = this.current.map((summary) => summary?.id ?? -1);
    return this.index;
  }

  private slots(): Slot[] {
    const slots: Slot[] = [];
    this.current.forEach((summary, slot) => {
      if (summary === null) return;
      const { minX, minY, maxX, maxY, id } = summary;
      slots.push({ minX, minY, maxX, maxY, slot, id });
    });
    return slots;
  }

  // Whether two rings' pieces need testing: one of them is curved, and the
  // sample test did not find their samples apart (the header).
  private mayMeet(a: number, b: number): boolean {
    const first = this.current[a];
    const second = this.current[b];
    if (first === null || first === undefined || second === null || second === undefined) {
      return false;
    }
    if (!first.curved && !second.curved) return false;
    const pointsA = (this.polylines[a] as Polyline).points;
    const pointsB = (this.polylines[b] as Polyline).points;
    return this.samples?.near(pointsA, pointsB) !== false;
  }

  private *testSteps(a: number, b: number): TraceSteps<void> {
    yield;
    const first = this.current[a] as RingSummary;
    const second = this.current[b] as RingSummary;
    const piecesA = yield* this.piecesSteps(first, this.polylines[a] as Polyline);
    const piecesB = yield* this.piecesSteps(second, this.polylines[b] as Polyline);
    if (ringsMeet(piecesA, piecesB)) this.meetings.push({ a, b });
  }

  // Whether a ring's curves meet themselves. Only pieces close along the ring
  // can meet when its samples that are not neighbours stay apart, unless its
  // pieces were halved (the header).
  private selfTest(pieces: RingPieces, polyline: Polyline): boolean {
    if (pieces.cubics.length === 0) return false;
    return !pieces.halved && this.samples?.nearItself(polyline.points) === false
      ? ringMeetsNeighbours(pieces)
      : ringMeetsItself(pieces);
  }
}

// A ring the repair replaced is never tested again (a ring only moves on
// toward its source), so its pieces go; they would be cut again if it were.
function release(summary: RingSummary | null | undefined): void {
  if (summary !== null && summary !== undefined) summary.pieces = undefined;
}

function meetsItself(summary: RingSummary | null): boolean {
  return summary?.meetsItself === true;
}

function ringSummary(
  box: ContourBox,
  id: number,
  curved: boolean,
  selfMeeting: boolean,
): RingSummary {
  const { minX, minY, maxX, maxY } = box;
  return { minX, minY, maxX, maxY, id, curved, meetsItself: selfMeeting, pieces: undefined };
}
