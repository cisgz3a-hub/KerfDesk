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

import type { Polyline } from '../scene';
import { type ContourBox } from './contour-bounds';
import { ContourBoxIndex } from './contour-box-index';
import {
  ringMeetsItself,
  ringPiecesSteps,
  ringsMeet,
  type RingPieces,
} from './compact-curve-pieces';
import { traceRingCurve } from './trace-curves';
import type { TraceSteps } from './trace-steps';

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
  private index: ContourBoxIndex<Slot> | null = null;
  private indexedIds: number[] = [];
  private meetings: Meeting[] = [];

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
    const geometries: (RingPieces | null)[] = [];
    const changed: number[] = [];
    for (const [slot, polyline] of rings.entries()) {
      if (cooperate) yield;
      const geometry = yield* this.piecesSteps(polyline);
      geometries.push(geometry);
      if (geometry?.id !== previous[slot]?.id) changed.push(slot);
      if (meetsItself(geometry)) conflicts.add(slot);
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
      onPair?.(meeting.a, meeting.b);
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
    if (ringsMeet(first, second)) this.meetings.push({ a, b });
  }
}

// Whether a ring's curves meet themselves (tested once per ring).
function meetsItself(geometry: RingPieces | null): boolean {
  if (geometry === null || geometry.cubics.length === 0) return false;
  geometry.meetsItself ??= ringMeetsItself(geometry);
  return geometry.meetsItself;
}
