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

  /** The boundary's edges if this cache has prepared them, else undefined. */
  preparedEdges(points: ReadonlyArray<Vec2>): ContourEdges | null | undefined {
    return this.geometries.get(points);
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
function occupiedCells(geometry: ContourEdges): Set<number> | null {
  const cells = new Set<number>();
  const cell = (value: number): number => Math.floor(value / OCCUPANCY_CELL_PX);
  const { points, count } = geometry;
  for (let i = 0; i < count; i += 1) {
    const a = points[i] as Vec2,
      b = points[i + 1 === count ? 0 : i + 1] as Vec2;
    const x0 = cell(Math.min(a.x, b.x));
    const x1 = cell(Math.max(a.x, b.x));
    const y0 = cell(Math.min(a.y, b.y));
    const y1 = cell(Math.max(a.y, b.y));
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
  // Every overlapping edge pair is tested, each once with `a`'s edge first.
  // The earliest contact is a minimum under a total order, so the order the
  // pairs arrive in cannot change the choice. Edges are made only for pairs
  // that meet.
  const aPoints = a.points,
    aCount = a.count,
    bPoints = b.points,
    bCount = b.count;
  yield* a.index.overlapIdsSteps(
    b.index,
    (i, j) => {
      // Within one loop each unordered pair is tested once, from its lower edge.
      if (sameLoop && (j <= i || adjacentContourEdgeIndices(i, j, aCount))) return;
      const a0 = aPoints[i] as Vec2,
        a1 = aPoints[i + 1 === aCount ? 0 : i + 1] as Vec2,
        b0 = bPoints[j] as Vec2,
        b1 = bPoints[j + 1 === bCount ? 0 : j + 1] as Vec2;
      if (
        orientation.sign(a0, a1, b0) * orientation.sign(a0, a1, b1) <= 0 &&
        orientation.sign(b0, b1, a0) * orientation.sign(b0, b1, a1) <= 0
      ) {
        rememberContact(
          choices,
          contourEdge(aPoints, i, aCount),
          contourEdge(bPoints, j, bCount),
          sameLoop,
        );
      }
    },
    cooperate,
  );
  return choices;
}
