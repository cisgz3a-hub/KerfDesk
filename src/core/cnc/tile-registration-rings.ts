// Rings a cut goes round, read from its path (ADR-392 Amendment 8, N7-P1-1).
// Shared by the registration bore keep-out and the open-outline check.

import type { Vec2 } from '../scene';

const MIN_RING_VERTICES = 3;
const MIN_RING_AREA_MM2 = 1e-6;
const VERTEX_KEY_DECIMALS = 6;

// A closed cut encloses a part, a pocket or a hole: never a place for a bore.
// Most closed cuts do not compile as closed passes. A profile with its default
// lead (ADR-250) is one open path: lead in, the ring, lead out. A tabbed ring
// rises over its tabs, and a ramped ring laps. Each still goes round its ring
// and comes back to the ring's start vertex, so the stretch between a vertex
// and the path's next return to it is a ring (N7-P1-1). Reading the path, not
// a compile flag, keeps this true for any entry or tab the profile has. An open
// cut never returns to a vertex, and a zig-zag ramp's back-and-forth encloses
// no area, so neither adds a ring.
export function ringsOf(points: ReadonlyArray<Vec2>): ReadonlyArray<ReadonlyArray<Vec2>> {
  const rings: Array<ReadonlyArray<Vec2>> = [];
  let seen = new Map<string, number>();
  for (const [index, point] of points.entries()) {
    const key = vertexKey(point);
    const start = seen.get(key);
    if (start !== undefined && index - start >= MIN_RING_VERTICES) {
      const ring = points.slice(start, index);
      if (Math.abs(signedArea(ring)) > MIN_RING_AREA_MM2) rings.push(ring);
      seen = new Map();
    }
    if (!seen.has(key)) seen.set(key, index);
  }
  return rings;
}

function vertexKey(point: Vec2): string {
  return `${point.x.toFixed(VERTEX_KEY_DECIMALS)},${point.y.toFixed(VERTEX_KEY_DECIMALS)}`;
}

/** Signed area of a polygon closed from its last point back to its first. */
export function signedArea(ring: ReadonlyArray<Vec2>): number {
  let twice = 0;
  for (const [index, a] of ring.entries()) {
    const b = ring[(index + 1) % ring.length] as Vec2;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

/** Non-zero winding: is the point inside the polygon closed across its ends? */
export function windsAround(ring: ReadonlyArray<Vec2>, point: Vec2): boolean {
  let winding = 0;
  for (const [index, a] of ring.entries()) {
    const b = ring[(index + 1) % ring.length] as Vec2;
    const side = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
    if (a.y <= point.y && b.y > point.y && side > 0) winding += 1;
    else if (b.y <= point.y && a.y > point.y && side < 0) winding -= 1;
  }
  return winding !== 0;
}
