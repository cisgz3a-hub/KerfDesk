// Closed-loop primitives for choosing where a closed Line cut starts (ADR-385).
//
// A closed CutSegment repeats its first point at the end (job.ts). Moving its
// start rotates the vertex ring and re-closes it at the new first vertex;
// reversing it walks the same ring backwards from the same start. Neither
// creates, moves nor drops a vertex, so the burned geometry — including any
// kerf offset and tab split already applied at compile time — is exactly the
// drawn one. Only where the beam enters, and which way it travels, changes.

import type { Vec2 } from '../scene';

// A vertex whose path turns by at least this much reads as a corner: square,
// hexagon and octagon corners qualify, while the few-degree bends of a
// flattened curve or a gentle polyline do not. The start/stop mark is least
// visible where the edge already changes direction.
export const CORNER_MIN_TURN_DEG = 45;

const SAME_POINT_EPS_MM = 1e-9;
const TURN_EPS_DEG = 1e-6;

export function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= SAME_POINT_EPS_MM && Math.abs(a.y - b.y) <= SAME_POINT_EPS_MM;
}

/** The ring of a closed polyline: its vertices without the repeated closing point. */
export function closedLoopRing(polyline: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = polyline[0];
  const last = polyline[polyline.length - 1];
  if (polyline.length >= 2 && first !== undefined && last !== undefined && samePoint(first, last)) {
    return polyline.slice(0, -1);
  }
  return polyline;
}

/**
 * The same closed cut entered at ring vertex `vertexIndex`. Index 0 (or an
 * index outside the ring) returns the input unchanged, so the default start
 * keeps its identity and its bytes.
 */
export function rotateClosedPolyline(
  polyline: ReadonlyArray<Vec2>,
  vertexIndex: number,
): ReadonlyArray<Vec2> {
  const ring = closedLoopRing(polyline);
  const start = ring[vertexIndex];
  if (vertexIndex <= 0 || start === undefined) return polyline;
  return [...ring.slice(vertexIndex), ...ring.slice(0, vertexIndex), start];
}

/** The same closed cut from the same start, travelled the other way round. */
export function reverseClosedPolyline(polyline: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const ring = closedLoopRing(polyline);
  const start = ring[0];
  if (start === undefined || ring.length < 3) return polyline;
  const out: Vec2[] = [start];
  for (let i = ring.length - 1; i >= 1; i -= 1) out.push(ring[i] as Vec2);
  out.push(start);
  return out;
}

/**
 * Direction change at each ring vertex, in degrees: 0 goes straight on, 90 is
 * a square corner, 180 doubles back. Coincident neighbours are skipped so a
 * duplicated vertex does not hide the corner it sits on; a ring with fewer
 * than three distinct vertices has no corners and reports 0 everywhere.
 */
export function ringTurnAnglesDeg(ring: ReadonlyArray<Vec2>): ReadonlyArray<number> {
  const turns = new Array<number>(ring.length).fill(0);
  if (ring.length < 3) return turns;
  for (let i = 0; i < ring.length; i += 1) {
    const here = ring[i] as Vec2;
    const previous = distinctNeighbour(ring, i, -1);
    const next = distinctNeighbour(ring, i, 1);
    if (previous === null || next === null) continue;
    turns[i] = turnDeg(
      { x: here.x - previous.x, y: here.y - previous.y },
      { x: next.x - here.x, y: next.y - here.y },
    );
  }
  return turns;
}

/** Ring indices whose turn reaches `minTurnDeg`, ascending. */
export function cornerVertexIndices(
  ring: ReadonlyArray<Vec2>,
  minTurnDeg: number = CORNER_MIN_TURN_DEG,
): ReadonlyArray<number> {
  const out: number[] = [];
  ringTurnAnglesDeg(ring).forEach((turn, index) => {
    // acos rounding must not drop an exact regular-octagon corner.
    if (turn >= minTurnDeg - TURN_EPS_DEG) out.push(index);
  });
  return out;
}

/** Unit direction of the first real edge leaving ring vertex 0, forward or backward. */
export function firstEdgeDirection(ring: ReadonlyArray<Vec2>, step: 1 | -1): Vec2 | null {
  const start = ring[0];
  const next = distinctNeighbour(ring, 0, step);
  if (start === undefined || next === null) return null;
  return unit({ x: next.x - start.x, y: next.y - start.y });
}

export function unit(vector: Vec2): Vec2 | null {
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length <= SAME_POINT_EPS_MM) return null;
  return { x: vector.x / length, y: vector.y / length };
}

function distinctNeighbour(ring: ReadonlyArray<Vec2>, index: number, step: 1 | -1): Vec2 | null {
  const here = ring[index];
  if (here === undefined) return null;
  for (let offset = 1; offset < ring.length; offset += 1) {
    const candidate = ring[(((index + step * offset) % ring.length) + ring.length) % ring.length];
    if (candidate !== undefined && !samePoint(candidate, here)) return candidate;
  }
  return null;
}

function turnDeg(incoming: Vec2, outgoing: Vec2): number {
  const a = unit(incoming);
  const b = unit(outgoing);
  if (a === null || b === null) return 0;
  const cos = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y));
  return (Math.acos(cos) * 180) / Math.PI;
}
