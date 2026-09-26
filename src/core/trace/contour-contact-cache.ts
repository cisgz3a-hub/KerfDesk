import type { Polyline, Vec2 } from '../scene';
import { unionContourBoxes } from './contour-bounds';
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
import { visitContourBoxPairsSteps } from './contour-spatial';
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
    const pairs: [Loop, Loop][] = [];
    yield* visitContourBoxPairsSteps(loops, (a, b) =>
      pairs.push(a.loop < b.loop ? [a, b] : [b, a]),
    );
    for (const [a, b] of pairs) {
      if (cooperate) yield;
      const choices = yield* this.pairSteps(a.geometry, b.geometry);
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
      choices = yield* findContactsSteps(a, b, false, this.orientation);
      pairs.set(b, choices);
    }
    return choices;
  }
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
  // pairs arrive in cannot change the choice.
  yield* a.index.overlapPairsSteps(
    b.index,
    (first, second) => {
      if (skipContact(first, second, sameLoop)) return;
      if (edgesMeet(first, second, orientation)) rememberContact(choices, first, second, sameLoop);
    },
    cooperate,
  );
  return choices;
}

// Within one loop each unordered pair is tested once, from its lower edge.
function skipContact(first: ContourEdge, second: ContourEdge, sameLoop: boolean): boolean {
  return sameLoop && (second.index <= first.index || adjacentContourEdges(first, second));
}

function edgesMeet(a: ContourEdge, b: ContourEdge, orientation: ContourOrientation): boolean {
  return (
    orientation.sign(a.a, a.b, b.a) * orientation.sign(a.a, a.b, b.b) <= 0 &&
    orientation.sign(b.a, b.b, a.a) * orientation.sign(b.a, b.b, a.b) <= 0
  );
}
