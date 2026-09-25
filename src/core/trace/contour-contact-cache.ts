import type { Polyline, Vec2 } from '../scene';
import { unionContourBoxes, type ContourBox } from './contour-bounds';
import {
  contourEdgesSteps,
  adjacentContourEdges,
  type ContourEdge,
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

/** Cache immutable boundary work while reproducing the global edge sweep order. */
export class ContourContactCache {
  private readonly geometries = new WeakMap<ReadonlyArray<Vec2>, ContourEdges | null>();
  private readonly selfContacts = new WeakMap<ContourEdges, ContactChoices>();
  private readonly pairContacts = new WeakMap<
    ContourEdges,
    WeakMap<ContourEdges, ContactChoices>
  >();
  private readonly orientation = new ContourOrientation();
  private readonly loopPairs = new ContourPairCache();
  private readonly occupancy = new WeakMap<ContourEdges, Set<number> | null>();

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
      let choices = this.loopPairs.recall(slot) as ContactChoices | undefined;
      if (choices === undefined) {
        choices = yield* this.pairSteps(a.geometry, b.geometry);
        this.loopPairs.remember(slot, choices);
      }
      const contact = choices[axis];
      if (contact !== null) events.push(ownedContact(contact, a.loop, b.loop));
    }
    return events;
  }

  private *pairSteps(a: ContourEdges, b: ContourEdges): TraceSteps<ContactChoices> {
    yield;
    let pairs = this.pairContacts.get(a);
    if (pairs === undefined) {
      pairs = new WeakMap();
      this.pairContacts.set(a, pairs);
    }
    let choices = pairs.get(b);
    if (choices === undefined) {
      // Meeting edges have touching boxes, which share a coarse cell; two
      // boundaries with no cell in common cannot meet.
      choices = this.shareCell(a, b)
        ? yield* findContactsSteps(a, b, false, this.orientation)
        : { minX: null, minY: null };
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

  // The coarse cells a boundary's edge boxes touch (inclusive), or null when
  // an edge spans too many cells to list (the pair is then just measured).
  private cellsOf(geometry: ContourEdges): Set<number> | null {
    let cells = this.occupancy.get(geometry);
    if (cells === undefined) {
      cells = occupiedCells(geometry.edges);
      this.occupancy.set(geometry, cells);
    }
    return cells;
  }
}

const OCCUPANCY_CELL_PX = 8;
const MAX_CELLS_PER_EDGE = 64;
const OCCUPANCY_KEY_STRIDE = 2 ** 26;

function occupiedCells(edges: ReadonlyArray<ContourEdge>): Set<number> | null {
  const cells = new Set<number>();
  const cell = (value: number): number => Math.floor(value / OCCUPANCY_CELL_PX);
  for (const edge of edges) {
    const x0 = cell(edge.minX);
    const x1 = cell(edge.maxX);
    const y0 = cell(edge.minY);
    const y1 = cell(edge.maxY);
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
): TraceSteps<ContactChoices> {
  const cooperate = yield;
  const choices: ContactChoices = { minX: null, minY: null };
  const { scanFirst, edges } = scanPlan(a, b, sameLoop);
  const target = scanFirst ? b : a;
  let visited = 0;
  for (const edge of edges) {
    if (cooperate) yield;
    for (const other of target.index.query(edge)) {
      if (cooperate && ++visited % 256 === 0) yield;
      if (skipContact(edge, other, sameLoop)) continue;
      const first = scanFirst ? edge : other,
        second = scanFirst ? other : edge;
      if (edgesMeet(first, second, orientation)) rememberContact(choices, first, second, sameLoop);
    }
  }
  return choices;
}

// Which boundary's edges to walk. An edge can only meet the other boundary
// inside that boundary's box, so two different boundaries walk just the
// edges of one that lie in the other's box, taking the side with fewer: a
// ring nested in another then walks the few edges of the outer one near the
// inner one's box, not every edge of the inner one. One boundary against
// itself walks every edge.
function scanPlan(
  a: ContourEdges,
  b: ContourEdges,
  sameLoop: boolean,
): { readonly scanFirst: boolean; readonly edges: ReadonlyArray<ContourEdge> } {
  if (sameLoop) return { scanFirst: true, edges: a.edges };
  // Inside the other's box every edge qualifies, so only the other side
  // needs a query (and is walked when it is the shorter list).
  if (boxWithin(a, b)) {
    const fromB = b.index.query(a);
    return fromB.length < a.edges.length
      ? { scanFirst: false, edges: fromB }
      : { scanFirst: true, edges: a.edges };
  }
  if (boxWithin(b, a)) {
    const fromA = a.index.query(b);
    return fromA.length <= b.edges.length
      ? { scanFirst: true, edges: fromA }
      : { scanFirst: false, edges: b.edges };
  }
  const fromA = a.index.query(b);
  if (fromA.length === 0) return { scanFirst: true, edges: fromA };
  const fromB = b.index.query(a);
  return fromA.length <= fromB.length
    ? { scanFirst: true, edges: fromA }
    : { scanFirst: false, edges: fromB };
}

function boxWithin(inner: ContourBox, outer: ContourBox): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY
  );
}

function skipContact(edge: ContourEdge, other: ContourEdge, sameLoop: boolean): boolean {
  return sameLoop && (other.index <= edge.index || adjacentContourEdges(edge, other));
}

function edgesMeet(a: ContourEdge, b: ContourEdge, orientation: ContourOrientation): boolean {
  return (
    orientation.sign(a.a, a.b, b.a) * orientation.sign(a.a, a.b, b.b) <= 0 &&
    orientation.sign(b.a, b.b, a.a) * orientation.sign(b.a, b.b, a.b) <= 0
  );
}
