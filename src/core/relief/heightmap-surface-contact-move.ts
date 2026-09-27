// Which elements can matter along one straight move (ADR-421 Amendment 1).
//
// Finishing checks every move against the exact contact every quarter cell,
// and nearly every check lands where the move already lies on the contact: a
// row on a plane, a link along the floor. Before those checks run, this finds
// the elements that could lift the tip more than the tolerance above the move
// anywhere along it, and the checks then solve only those.
//
// An element is dropped when its highest corner is no higher than the lower
// end of the move plus the tolerance (the tip is the cutter's lowest point),
// when it lies beyond the cutter's radius of the move's bounding box, or when
// its facet planes stay within the tolerance of the move at both ends. The
// cutter's contact with a triangle never rises above the contact with its
// whole plane (FacetResult.planeBound), which is linear in the cutter's axis;
// the highest of an element's facets is convex, and a convex function less
// the straight move peaks at one of the move's ends.

import {
  type ElementContact,
  elementFacets,
  read32,
  read64,
} from './heightmap-surface-contact-element';

export type MovePoint = { readonly x: number; readonly y: number; readonly z: number };

/** The elements kept for the latest move, reused from move to move. */
export type MoveElements = { elements: Int32Array; count: number };

export type MoveContact = ElementContact & {
  readonly elementTop: Float32Array;
  readonly mmPerCell: number;
  readonly move: MoveElements;
};

/**
 * Keeps, in `contact.move`, the elements that might lift the tip more than
 * `toleranceMm` above the straight move from `from` to `to`. Returns how many.
 */
export function collectMoveElements(
  contact: MoveContact,
  from: MovePoint,
  to: MovePoint,
  toleranceMm: number,
): number {
  const { widthCells, heightCells, xs, ys, mmPerCell, radiusMm } = contact;
  const box = {
    minX: Math.min(from.x, to.x),
    maxX: Math.max(from.x, to.x),
    minY: Math.min(from.y, to.y),
    maxY: Math.max(from.y, to.y),
  };
  const low = Math.min(from.z, to.z) + toleranceMm;
  const minI = sampleAtOrBefore(xs, widthCells, box.minX - radiusMm, mmPerCell);
  const maxI = sampleAtOrBefore(xs, widthCells, box.maxX + radiusMm, mmPerCell);
  const minJ = sampleAtOrBefore(ys, heightCells, box.minY - radiusMm, mmPerCell);
  const maxJ = sampleAtOrBefore(ys, heightCells, box.maxY + radiusMm, mmPerCell);
  const move = contact.move;
  move.count = 0;
  for (let j = minJ; j <= maxJ; j += 1) {
    for (let i = minI; i <= maxI; i += 1) {
      const element = j * widthCells + i;
      const top = read32(contact.elementTop, element);
      if (!(top > low)) continue;
      if (!(top - nearDzToBox(contact, i, j, box) > low)) continue;
      if (!planeRises(contact, i, j, from, to, toleranceMm)) continue;
      if (move.count === move.elements.length) move.elements = grown(move.elements);
      move.elements[move.count] = element;
      move.count += 1;
    }
  }
  return move.count;
}

/**
 * The last sample at or before `coordinate` along one axis (the first when
 * the point lies before it).
 */
export function sampleAtOrBefore(
  centers: Float64Array,
  cells: number,
  coordinate: number,
  mmPerCell: number,
): number {
  let index = Math.min(cells - 1, Math.max(0, Math.floor(coordinate / mmPerCell - 0.5)));
  while (index > 0 && read64(centers, index) > coordinate) index -= 1;
  while (index + 1 < cells && read64(centers, index + 1) <= coordinate) index += 1;
  return index;
}

type Box = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

// The cutter law at the element's nearest approach to the move's bounding box,
// which is never farther than its nearest approach to the move itself.
function nearDzToBox(contact: MoveContact, i: number, j: number, box: Box): number {
  const x0 = read64(contact.xs, i);
  const x1 = read64(contact.xs, Math.min(i + 1, contact.widthCells - 1));
  const y0 = read64(contact.ys, j);
  const y1 = read64(contact.ys, Math.min(j + 1, contact.heightCells - 1));
  const dx = Math.max(0, x0 - box.maxX, box.minX - x1);
  const dy = Math.max(0, y0 - box.maxY, box.minY - y1);
  const distanceSquared = dx * dx + dy * dy;
  return distanceSquared > contact.radiusSquared
    ? Number.POSITIVE_INFINITY
    : contact.dz(Math.sqrt(distanceSquared));
}

// Whether the element's facet planes rise more than the tolerance above the
// move at either end. An element with no complete facet (a masked corner, the
// last row or column) answers +Infinity, so it is always kept.
function planeRises(
  contact: MoveContact,
  i: number,
  j: number,
  from: MovePoint,
  to: MovePoint,
  toleranceMm: number,
): boolean {
  const start = elementFacets(contact, i, j, from.x, from.y, Number.NEGATIVE_INFINITY).planeBound;
  if (!(start <= from.z + toleranceMm)) return true;
  const end = elementFacets(contact, i, j, to.x, to.y, Number.NEGATIVE_INFINITY).planeBound;
  return !(end <= to.z + toleranceMm);
}

function grown(elements: Int32Array): Int32Array {
  const next = new Int32Array(Math.max(64, elements.length * 2));
  next.set(elements);
  return next;
}
