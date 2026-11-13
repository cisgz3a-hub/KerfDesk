// Where a lead joins a tabbed ring (ADR-258 Amendment 5, CNC audit v3 N1-P2-3).
//
// A lead is cut at the Z of the ring point it joins. Joined where the ring runs
// at the cutting depth, its arc sweeps through-depth material beside the two
// tabs either side of the seam, and on a small hole that narrows or erases them
// (a 16 mm hole held by 3.3 mm instead of 5.2 mm bridges; a 5 mm lead radius
// removed both on an 18 mm hole). Joined in the middle of a tab instead, the
// lead rides the tab top, above every bridge, and the ring drops to the cut
// depth at the tab's own wall, a vertical move every tab already makes.
//
// Pure: no clock, no randomness, no I/O.

import type { Vec3 } from '../geometry/vec3';
import { maxOf } from '../util';

const EPS = 1e-9;

/**
 * `ring` (first point repeated last) restarted in the middle of its longest
 * run at the tab top, or `ring` itself when it is not a two-level tabbed ring
 * or already starts inside a tab.
 */
export function ringStartingInTab(ring: ReadonlyArray<Vec3>): ReadonlyArray<Vec3> {
  const cycle = ring.slice(0, -1);
  if (cycle.length < 3) return ring;
  const levels = [...new Set(cycle.map((point) => point.z))];
  if (levels.length !== 2) return ring;
  const tabTop = maxOf(levels);
  if (startsInTab(cycle, tabTop)) return ring;
  const run = longestTabTopRun(cycle, tabTop);
  if (run === null) return ring;
  const split = pointAlongRun(cycle, run);
  if (split === null) return ring;
  const next = cycle[(split.edge + 1) % cycle.length] as Vec3;
  if (Math.hypot(next.x - split.point.x, next.y - split.point.y) <= EPS) {
    // The middle of the run is a vertex: start there, adding no point.
    const from = (split.edge + 1) % cycle.length;
    const restarted = [...cycle.slice(from), ...cycle.slice(0, from)];
    return [...restarted, restarted[0] as Vec3];
  }
  const rotated: Vec3[] = [split.point];
  for (let step = 1; step <= cycle.length; step += 1) {
    rotated.push(cycle[(split.edge + step) % cycle.length] as Vec3);
  }
  rotated.push(split.point);
  return rotated;
}

// The edge leaving the seam and the one arriving at it both ride the tab top.
function startsInTab(cycle: ReadonlyArray<Vec3>, tabTop: number): boolean {
  const first = cycle[0] as Vec3;
  const second = cycle[1] as Vec3;
  const last = cycle[cycle.length - 1] as Vec3;
  return first.z === tabTop && second.z === tabTop && last.z === tabTop;
}

type Run = { readonly firstEdge: number; readonly edges: number; readonly length: number };

// Edge i runs from cycle[i] to cycle[i + 1]. A run is consecutive edges with
// both ends at the tab top; the vertical tab walls end it.
function longestTabTopRun(cycle: ReadonlyArray<Vec3>, tabTop: number): Run | null {
  const count = cycle.length;
  const onTop = (edge: number): boolean =>
    (cycle[edge] as Vec3).z === tabTop && (cycle[(edge + 1) % count] as Vec3).z === tabTop;
  const start = Array.from({ length: count }, (_, edge) => edge).find((edge) => !onTop(edge));
  if (start === undefined) return null;
  let best: Run | null = null;
  let current: Run | null = null;
  for (let step = 1; step <= count; step += 1) {
    const edge = (start + step) % count;
    if (!onTop(edge)) {
      current = null;
      continue;
    }
    const length = edgeLength(cycle, edge);
    const extended: Run =
      current === null
        ? { firstEdge: edge, edges: 1, length }
        : {
            firstEdge: current.firstEdge,
            edges: current.edges + 1,
            length: current.length + length,
          };
    current = extended;
    if (best === null || extended.length > best.length + EPS) best = extended;
  }
  return best !== null && best.length > EPS ? best : null;
}

function pointAlongRun(
  cycle: ReadonlyArray<Vec3>,
  run: Run,
): { readonly point: Vec3; readonly edge: number } | null {
  let remaining = run.length / 2;
  for (let offset = 0; offset < run.edges; offset += 1) {
    const edge = (run.firstEdge + offset) % cycle.length;
    const length = edgeLength(cycle, edge);
    if (remaining <= length + EPS && length > EPS) {
      const a = cycle[edge] as Vec3;
      const b = cycle[(edge + 1) % cycle.length] as Vec3;
      const ratio = Math.min(1, remaining / length);
      return {
        point: { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio, z: a.z },
        edge,
      };
    }
    remaining -= length;
  }
  return null;
}

function edgeLength(cycle: ReadonlyArray<Vec3>, edge: number): number {
  const a = cycle[edge] as Vec3;
  const b = cycle[(edge + 1) % cycle.length] as Vec3;
  return Math.hypot(b.x - a.x, b.y - a.y);
}
