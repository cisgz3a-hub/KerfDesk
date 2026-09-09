import type { Polyline, Vec2 } from '../scene';
import { exactSegmentContact } from './exact-segment-contact';
import {
  contactPointCount,
  polylineContactIndex,
  visitContactCandidates,
  type ContactSegment,
} from './polyline-contact-index';

type Insertions = Map<number, Map<number, Map<string, Vec2>>>;
export type PreparedPolylineContacts = {
  readonly polylines: Polyline[];
  readonly pinnedPoints: ReadonlySet<Vec2>;
};

/** Pin every existing vertex contact with another, nonincident source segment.
 * Segment-interior receivers gain the exact contacting vertex. Work occurs in
 * the source coordinate domain before anisotropic mapping introduces roundoff.
 * Caller objects stay immutable; pins identify point references through welding.
 */
export function preparePolylineContacts(
  polylines: ReadonlyArray<Polyline>,
): PreparedPolylineContacts {
  const index = polylineContactIndex(polylines);
  const pinnedPoints = new Set<Vec2>(),
    insertions: Insertions = new Map();
  polylines.forEach((polyline, owner) => {
    const count = contactPointCount(polyline);
    polyline.points.slice(0, count).forEach((point, at) => {
      visitContactCandidates(point, index, (segment) => {
        if (segment.owner === owner && (segment.from === at || segment.to === at)) return;
        if (!exactSegmentContact(point, segment.start, segment.end)) return;
        pinnedPoints.add(point);
        pinReceiver(point, segment, pinnedPoints, insertions);
      });
    });
  });
  return {
    polylines: polylines.map((polyline, owner) => insertContacts(polyline, insertions.get(owner))),
    pinnedPoints,
  };
}

function pinReceiver(
  point: Vec2,
  segment: ContactSegment,
  pins: Set<Vec2>,
  insertions: Insertions,
): void {
  const endpoint = [segment.start, segment.end].find((p) => p.x === point.x && p.y === point.y);
  if (endpoint !== undefined) {
    pins.add(endpoint);
    return;
  }
  const owner = insertions.get(segment.owner) ?? new Map<number, Map<string, Vec2>>();
  const points = owner.get(segment.from) ?? new Map<string, Vec2>();
  points.set(`${point.x},${point.y}`, point);
  owner.set(segment.from, points);
  insertions.set(segment.owner, owner);
}

function insertContacts(
  polyline: Polyline,
  insertions: Map<number, Map<string, Vec2>> | undefined,
): Polyline {
  if (insertions === undefined) return polyline;
  const points = polyline.points.flatMap((point, from) => {
    const additions = insertions.get(from);
    if (additions === undefined) return [point];
    const next = polyline.points[(from + 1) % contactPointCount(polyline)] as Vec2;
    const isX = Math.abs(next.x - point.x) >= Math.abs(next.y - point.y);
    const direction = Math.sign(isX ? next.x - point.x : next.y - point.y);
    const sorted = [...additions.values()].sort(
      (a, b) => direction * (isX ? a.x - b.x : a.y - b.y),
    );
    return [point, ...sorted];
  });
  return { ...polyline, points };
}
