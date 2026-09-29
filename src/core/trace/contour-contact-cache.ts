import type { Polyline, Vec2 } from '../scene';
import { unionContourBoxes } from './contour-bounds';
import {
  adjacentContourEdgeIndices,
  contourEdge,
  contourEdgesSteps,
  type ContourEdges,
} from './contour-edges';
import {
  contactOrder,
  ownedContact,
  rememberContact,
  type ContactChoices,
  type ContourContact,
  type SweepAxis,
} from './contour-contact-order';
import { ContourOrientation } from './contour-orientation';
import { ContourPairCache } from './contour-pair-cache';
import type { TraceSteps } from './trace-steps';

type Loop = ContourEdges & { readonly loop: number; readonly geometry: ContourEdges };

/**
 * How close samples must come before the fitted curves they sample can meet
 * (the curve guard, compact-curve-contacts.ts, ADR-531). A fitted curve lies
 * within 0.02 px of the chord of its own sample step (compact-curve-sample.ts)
 * and the guard finds two pieces meeting only where they come within 4e-4 px
 * (compact-curve-meet.ts), so two curves can meet only where their sample
 * edges come within 2 x 0.02 + 4e-4 = 0.0404 px. The rest is room for rounding.
 */
export const SAMPLES_NEAR_PX = 0.045;

// What one measured pair of boundaries, or one boundary against itself,
// keeps: its earliest contacts, and whether two of its edges (of one
// boundary, two that are not neighbours) come within SAMPLES_NEAR_PX.
type Measured = ContactChoices & { near: boolean };

/** Cache immutable boundary work while reproducing the global edge sweep order. */
export class ContourContactCache {
  private readonly geometries = new WeakMap<ReadonlyArray<Vec2>, ContourEdges | null>();
  private readonly selfContacts = new WeakMap<ContourEdges, Measured>();
  private readonly pairContacts = new WeakMap<ContourEdges, WeakMap<ContourEdges, Measured>>();
  private readonly orientation = new ContourOrientation();
  private readonly loopPairs = new ContourPairCache();
  private readonly occupancy = new WeakMap<ContourEdges, Set<number> | null>();

  /** The boundary's edges if this cache has prepared them, else undefined. */
  preparedEdges(points: ReadonlyArray<Vec2>): ContourEdges | null | undefined {
    return this.geometries.get(points);
  }

  /** Whether two boundaries have edges within SAMPLES_NEAR_PX of each other,
   *  once this cache has measured the pair; undefined when it has not (their
   *  boxes do not overlap, a round took the uncached path, or a boundary has
   *  no edges). */
  samplesNear(a: ReadonlyArray<Vec2>, b: ReadonlyArray<Vec2>): boolean | undefined {
    const first = this.geometries.get(a);
    const second = this.geometries.get(b);
    if (first === undefined || first === null || second === undefined || second === null) {
      return undefined;
    }
    // A pair is kept under its lower loop's geometry, which the caller need
    // not know.
    const measured =
      this.pairContacts.get(first)?.get(second) ?? this.pairContacts.get(second)?.get(first);
    return measured?.near;
  }

  /** Whether two edges of a boundary that are not neighbours come within
   *  SAMPLES_NEAR_PX of each other, once this cache has measured the
   *  boundary; undefined when it has not. */
  samplesNearItself(points: ReadonlyArray<Vec2>): boolean | undefined {
    const geometry = this.geometries.get(points);
    if (geometry === undefined || geometry === null) return undefined;
    return this.selfContacts.get(geometry)?.near;
  }

  *findSteps(polylines: ReadonlyArray<Polyline>): TraceSteps<Set<number> | undefined> {
    const cooperate = yield;
    const loops: Loop[] = [];
    for (const [loop, polyline] of polylines.entries()) {
      if (cooperate) yield;
      let geometry = this.geometries.get(polyline.points);
      if (geometry === undefined) {
        geometry = yield* contourEdgesSteps(polyline.points);
        this.geometries.set(polyline.points, geometry);
      }
      if (geometry === null) return undefined;
      loops.push({ ...geometry, loop, geometry });
    }
    const bounds = unionContourBoxes(loops);
    const axis = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY ? 'minX' : 'minY';
    const events = yield* this.eventsSteps(loops, axis);
    events.sort((a, b) => contactOrder(a, b, axis));
    const conflicts = new Set<number>();
    for (const event of events) {
      conflicts.add(event.first.owner);
      conflicts.add(event.second.owner);
    }
    return conflicts;
  }

  private *eventsSteps(loops: ReadonlyArray<Loop>, axis: SweepAxis): TraceSteps<ContourContact[]> {
    const cooperate = yield;
    const events: ContourContact[] = [];
    for (const { geometry, loop } of loops) {
      if (cooperate) yield;
      let choices = this.selfContacts.get(geometry);
      if (choices === undefined) {
        choices = yield* findContactsSteps(geometry, geometry, true, this.orientation);
        this.selfContacts.set(geometry, choices);
      }
      const contact = choices[axis];
      if (contact !== null) events.push(ownedContact(contact, loop, loop));
    }
    // Loop i's box is its geometry's, so the geometry is the pair key.
    const overlapping = yield* this.loopPairs.pairsSteps(loops, (loop) => loop.geometry);
    for (const { first, second, slot } of overlapping) {
      const [a, b] = first.loop < second.loop ? [first, second] : [second, first];
      if (cooperate) yield;
      let choices = this.loopPairs.recall(slot) as Measured | undefined;
      if (choices === undefined) {
        choices = yield* this.pairSteps(a.geometry, b.geometry);
        this.loopPairs.remember(slot, choices);
      }
      const contact = choices[axis];
      if (contact !== null) events.push(ownedContact(contact, a.loop, b.loop));
    }
    return events;
  }

  private *pairSteps(a: ContourEdges, b: ContourEdges): TraceSteps<Measured> {
    yield;
    let pairs = this.pairContacts.get(a);
    if (pairs === undefined) {
      pairs = new WeakMap();
      this.pairContacts.set(a, pairs);
    }
    let choices = pairs.get(b);
    if (choices === undefined) {
      // Meeting edges have touching boxes, which share a coarse cell; two
      // boundaries with no cell in common cannot meet. The cells are widened
      // by SAMPLES_NEAR_PX, so no cell in common also means nothing near.
      choices = this.shareCell(a, b)
        ? yield* findContactsSteps(a, b, false, this.orientation)
        : { minX: null, minY: null, near: false };
      pairs.set(b, choices);
    }
    return choices;
  }

  private shareCell(a: ContourEdges, b: ContourEdges): boolean {
    const cellsA = this.cellsOf(a);
    const cellsB = this.cellsOf(b);
    if (cellsA === null || cellsB === null) return true;
    const [small, large] = cellsA.size <= cellsB.size ? [cellsA, cellsB] : [cellsB, cellsA];
    for (const cell of small) if (large.has(cell)) return true;
    return false;
  }

  // The coarse cells a boundary's edge boxes touch (inclusive) once widened
  // by SAMPLES_NEAR_PX, or null when an edge spans too many cells to list
  // (the pair is then just measured).
  private cellsOf(geometry: ContourEdges): Set<number> | null {
    let cells = this.occupancy.get(geometry);
    if (cells === undefined) {
      cells = occupiedCells(geometry);
      this.occupancy.set(geometry, cells);
    }
    return cells;
  }
}

const OCCUPANCY_CELL_PX = 8;
const MAX_CELLS_PER_EDGE = 64;
const OCCUPANCY_KEY_STRIDE = 2 ** 26;

// Edge i's box is Math.min and Math.max of its two ends (contour-edges.ts),
// so the cells are read from the points without making the edges.
// Each box is widened by SAMPLES_NEAR_PX, so two edges that come within it of
// each other have overlapping widened boxes and share a cell. The widening
// cannot change a contact: every pair of boundaries that shared a cell before
// still does, and a pair that shares one only once widened has no two edge
// boxes that overlap (overlapping boxes share an unwidened cell), so the
// contact test, which runs only on overlapping boxes, finds nothing there.
function occupiedCells(geometry: ContourEdges): Set<number> | null {
  const cells = new Set<number>();
  const cell = (value: number): number => Math.floor(value / OCCUPANCY_CELL_PX);
  const { points, count } = geometry;
  for (let i = 0; i < count; i += 1) {
    const a = points[i] as Vec2,
      b = points[i + 1 === count ? 0 : i + 1] as Vec2;
    const x0 = cell(Math.min(a.x, b.x) - SAMPLES_NEAR_PX);
    const x1 = cell(Math.max(a.x, b.x) + SAMPLES_NEAR_PX);
    const y0 = cell(Math.min(a.y, b.y) - SAMPLES_NEAR_PX);
    const y1 = cell(Math.max(a.y, b.y) + SAMPLES_NEAR_PX);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS_PER_EDGE) return null;
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) cells.add(cx * OCCUPANCY_KEY_STRIDE + cy);
    }
  }
  return cells;
}

function* findContactsSteps(
  a: ContourEdges,
  b: ContourEdges,
  sameLoop: boolean,
  orientation: ContourOrientation,
): TraceSteps<Measured> {
  const cooperate = yield;
  const measured: Measured = { minX: null, minY: null, near: false };
  // Every overlapping edge pair is tested, each once with `a`'s edge first.
  // The earliest contact is a minimum under a total order, so the order the
  // pairs arrive in cannot change the choice. Edges are made only for pairs
  // that meet. Pairs whose boxes only come within SAMPLES_NEAR_PX are visited
  // for `near` alone: the contact test needs overlapping boxes, as two
  // collinear edges that do not touch pass its orientation products.
  const aPoints = a.points,
    aCount = a.count,
    bPoints = b.points,
    bCount = b.count;
  yield* a.index.overlapIdsSteps(
    b.index,
    (i, j, overlapping) => {
      // Within one loop each unordered pair is tested once, from its lower edge.
      if (sameLoop && (j <= i || adjacentContourEdgeIndices(i, j, aCount))) return;
      const a0 = aPoints[i] as Vec2,
        a1 = aPoints[i + 1 === aCount ? 0 : i + 1] as Vec2,
        b0 = bPoints[j] as Vec2,
        b1 = bPoints[j + 1 === bCount ? 0 : j + 1] as Vec2;
      if (
        overlapping &&
        orientation.sign(a0, a1, b0) * orientation.sign(a0, a1, b1) <= 0 &&
        orientation.sign(b0, b1, a0) * orientation.sign(b0, b1, a1) <= 0
      ) {
        rememberContact(
          measured,
          contourEdge(aPoints, i, aCount),
          contourEdge(bPoints, j, bCount),
          sameLoop,
        );
        measured.near = true;
      } else if (!measured.near && edgesWithin(a0, a1, b0, b1, SAMPLES_NEAR_PX)) {
        measured.near = true;
      }
    },
    cooperate,
    SAMPLES_NEAR_PX,
  );
  return measured;
}

// Whether edges a0-a1 and b0-b1 come within `limit` of each other. Edges that
// do not cross are closest at an end of one of them. Rounding moves these
// distances by far less than the room SAMPLES_NEAR_PX leaves, and the sign
// test can miss a crossing only when an end lies within rounding of the other
// edge, which the distances then find.
function edgesWithin(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2, limit: number): boolean {
  const squared = limit * limit;
  if (
    pointEdgeDistanceSquared(a0, b0, b1) <= squared ||
    pointEdgeDistanceSquared(a1, b0, b1) <= squared ||
    pointEdgeDistanceSquared(b0, a0, a1) <= squared ||
    pointEdgeDistanceSquared(b1, a0, a1) <= squared
  ) {
    return true;
  }
  const ax = a1.x - a0.x,
    ay = a1.y - a0.y,
    bx = b1.x - b0.x,
    by = b1.y - b0.y;
  const sideB0 = ax * (b0.y - a0.y) - ay * (b0.x - a0.x);
  const sideB1 = ax * (b1.y - a0.y) - ay * (b1.x - a0.x);
  const sideA0 = bx * (a0.y - b0.y) - by * (a0.x - b0.x);
  const sideA1 = bx * (a1.y - b0.y) - by * (a1.x - b0.x);
  return sideB0 * sideB1 < 0 && sideA0 * sideA1 < 0;
}

function pointEdgeDistanceSquared(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    px = p.x - a.x,
    py = p.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
  const ex = px - t * dx,
    ey = py - t * dy;
  return ex * ex + ey * ey;
}
