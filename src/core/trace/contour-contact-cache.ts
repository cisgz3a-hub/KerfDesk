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
  const scanFirst = a.edges.length <= b.edges.length;
  const scan = scanFirst ? a : b,
    target = scanFirst ? b : a;
  let visited = 0;
  for (const edge of scan.edges) {
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

function skipContact(edge: ContourEdge, other: ContourEdge, sameLoop: boolean): boolean {
  return sameLoop && (other.index <= edge.index || adjacentContourEdges(edge, other));
}

function edgesMeet(a: ContourEdge, b: ContourEdge, orientation: ContourOrientation): boolean {
  return (
    orientation.sign(a.a, a.b, b.a) * orientation.sign(a.a, a.b, b.b) <= 0 &&
    orientation.sign(b.a, b.b, a.a) * orientation.sign(b.a, b.b, a.b) <= 0
  );
}
