// Painting the nested selection level by level (ADR-410 Amendment 3), without
// sweeping rings a level cannot touch (perf audit N3-P3-1).
//
// Each level is one clipper union (even depth) or difference (odd depth) with
// the region painted so far. Clipper's sweep keeps every ring that spans a scan
// line in its active list, so on nested rings each level paid for all the rings
// around it, and 300 concentric rings took 30 s.
//
// When every ring of the selection is simple and stays clear of every other
// edge, no level can cross, touch or re-split anything: each union or
// difference only decides which whole rings remain. A level then needs only the
// rings it could change. Rings off to its side are set aside, and so are the
// rings around it, in pairs that cancel (an outline and the hole inside it),
// which leaves at most the innermost outline when the level sits in filled area.
// The last level always takes the whole region, so the result is clipper's own
// output over the same rings. A selection whose rings come closer than that is
// painted against the whole region at every level, as before.

import { areaD, differenceD, FillRule, unionD, type PathD, type PathsD } from 'clipper2-ts';
import { canonicalizeVectorPaths } from './vector-path-canonical';
import { VECTOR_PATH_PRECISION_DECIMALS } from './vector-path-regions';

/** Region to add (even depth) or carve (odd depth). */
export type NestedUnit = { readonly depth: number; readonly paths: PathsD };

type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type Point = { readonly x: number; readonly y: number };

// Four steps of the 1 µm grid: edges further apart than this neither cross nor
// touch once clipper has rounded them.
const APART_MM = 4 * 10 ** -VECTOR_PATH_PRECISION_DECIMALS;
// Grid cells an edge may cover, on average, before the clearance check gives up
// and the selection is painted against the whole region.
const CELLS_PER_EDGE = 16;

/** Level by level from the outside in: add the even depths, carve the odd ones. */
export function paintNestedUnits(units: ReadonlyArray<NestedUnit>): PathsD {
  const deepest = units.reduce((most, unit) => Math.max(most, unit.depth), 0);
  const levels: Array<{ readonly depth: number; readonly units: NestedUnit[] }> = [];
  for (let depth = 0; depth <= deepest; depth += 1) {
    const level = units.filter((unit) => unit.depth === depth);
    if (level.length > 0) levels.push({ depth, units: level });
  }
  const apart = levels.length > 2 && ringsApart(units.flatMap((unit) => unit.paths));
  let region: PathsD = [];
  levels.forEach((level, index) => {
    const add = level.depth % 2 === 0;
    const last = index === levels.length - 1;
    const local = apart && !last ? paintApart(region, level.units, add) : null;
    region = local ?? paint(region, level.units, add);
  });
  return canonicalizeVectorPaths(region);
}

function paint(region: PathsD, level: ReadonlyArray<NestedUnit>, add: boolean): PathsD {
  const paths = level.flatMap((unit) => unit.paths);
  return add
    ? unionD(region, paths, FillRule.NonZero, VECTOR_PATH_PRECISION_DECIMALS)
    : differenceD(region, paths, FillRule.NonZero, VECTOR_PATH_PRECISION_DECIMALS);
}

type Encloser = { readonly path: PathD; readonly winding: number; readonly area: number };

// Null when the level's units share a box, or a ring of the region could lie
// inside the level.
function paintApart(region: PathsD, level: ReadonlyArray<NestedUnit>, add: boolean): PathsD | null {
  const unitBoxes = level.map((unit) => boxOf(unit.paths));
  if (!boxesApart(unitBoxes)) return null;
  const box = unitBoxes.reduce(joinBoxes);
  const probes = level.map((unit) => unit.paths[0]?.[0]);
  const aside: PathD[] = [];
  const enclosers: Encloser[] = [];
  for (const path of region) {
    const bounds = boxOf([path]);
    if (!boxesMeet(bounds, box)) {
      aside.push(path);
      continue;
    }
    if (!boxHolds(bounds, box)) return null;
    // The ring keeps clear of the level, so it winds the same way around every
    // point of a unit; units it winds differently around would be split by it.
    const windings = probes.map((probe) => (probe === undefined ? 0 : windingAt(path, probe)));
    const winding = windings[0] ?? 0;
    if (windings.some((other) => other !== winding)) return null;
    if (winding === 0) aside.push(path);
    else enclosers.push({ path, winding, area: Math.abs(areaD(path)) });
  }
  const kept = keptEnclosers(enclosers);
  if (kept === null) return null;
  for (const encloser of enclosers) if (!kept.includes(encloser.path)) aside.push(encloser.path);
  return [...aside, ...paint(kept, level, add)];
}

// The rings around a level nest one inside the next, alternating outline and
// hole, so their windings sum to 0 (the level sits in empty area) or 1 (in
// filled area). Setting aside all but the innermost outline then leaves the
// level's surroundings unchanged.
function keptEnclosers(enclosers: ReadonlyArray<Encloser>): PathD[] | null {
  const total = enclosers.reduce((sum, encloser) => sum + encloser.winding, 0);
  if (total === 0) return [];
  if (total !== 1) return null;
  const innermost = [...enclosers].sort((a, b) => a.area - b.area)[0];
  return innermost?.winding === 1 ? [innermost.path] : null;
}

// Non-zero winding number of a closed path around a point no edge passes near.
function windingAt(path: PathD, point: Point): number {
  let winding = 0;
  path.forEach((from, index) => {
    const to = path[(index + 1) % path.length];
    if (to === undefined) return;
    if (from.y <= point.y) {
      if (to.y > point.y && cross(from, to, point) > 0) winding += 1;
    } else if (to.y <= point.y && cross(from, to, point) < 0) {
      winding -= 1;
    }
  });
  return winding;
}

type Edge = { readonly ring: number; readonly index: number; readonly a: Point; readonly b: Point };

/**
 * True when no edge of any ring crosses or comes within APART_MM of another
 * edge, other than the two it shares a vertex with, and those meet at more
 * than a hair's angle. Edges are bucketed on a grid about one edge long.
 */
function ringsApart(rings: PathsD): boolean {
  const edges = ringEdges(rings);
  if (edges.length === 0) return true;
  const cells = filedEdges(edges);
  if (cells === null) return false;
  for (const list of cells.values()) {
    for (let first = 0; first < list.length; first += 1) {
      for (let second = first + 1; second < list.length; second += 1) {
        const a = list[first];
        const b = list[second];
        if (a !== undefined && b !== undefined && !edgesClear(a, b, rings)) return false;
      }
    }
  }
  return true;
}

function ringEdges(rings: PathsD): Edge[] {
  const edges: Edge[] = [];
  rings.forEach((ring, index) => {
    if (ring.length < 3) return;
    ring.forEach((a, at) => {
      const b = ring[(at + 1) % ring.length];
      if (b !== undefined) edges.push({ ring: index, index: at, a, b });
    });
  });
  return edges;
}

// Null when the edges would fill more cells than the check is worth.
function filedEdges(edges: ReadonlyArray<Edge>): Map<string, Edge[]> | null {
  const length = edges.reduce(
    (sum, edge) => sum + Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y),
    0,
  );
  const cell = Math.max(4 * APART_MM, length / edges.length);
  const cells = new Map<string, Edge[]>();
  let filed = 0;
  for (const edge of edges) {
    const minX = Math.floor((Math.min(edge.a.x, edge.b.x) - APART_MM) / cell);
    const maxX = Math.floor((Math.max(edge.a.x, edge.b.x) + APART_MM) / cell);
    const minY = Math.floor((Math.min(edge.a.y, edge.b.y) - APART_MM) / cell);
    const maxY = Math.floor((Math.max(edge.a.y, edge.b.y) + APART_MM) / cell);
    filed += (maxX - minX + 1) * (maxY - minY + 1);
    if (filed > CELLS_PER_EDGE * edges.length) return null;
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = `${x},${y}`;
        const list = cells.get(key);
        if (list === undefined) cells.set(key, [edge]);
        else list.push(edge);
      }
    }
  }
  return cells;
}

function edgesClear(first: Edge, second: Edge, rings: PathsD): boolean {
  const neighbours = neighboursClear(first, second, rings[first.ring]?.length ?? 0);
  if (neighbours !== null) return neighbours;
  if (segmentsCross(first, second)) return false;
  return (
    toSegment(first.a, second) > APART_MM &&
    toSegment(first.b, second) > APART_MM &&
    toSegment(second.a, first) > APART_MM &&
    toSegment(second.b, first) > APART_MM
  );
}

// Neighbours share a vertex: only their far ends must keep clear (no spike, no
// edge folded back on the last). Null when the edges are not neighbours.
function neighboursClear(first: Edge, second: Edge, length: number): boolean | null {
  if (first.ring !== second.ring || length === 0) return null;
  if ((first.index + 1) % length === second.index) {
    return toSegment(second.b, first) > APART_MM && toSegment(first.a, second) > APART_MM;
  }
  if ((second.index + 1) % length === first.index) {
    return toSegment(first.b, second) > APART_MM && toSegment(second.a, first) > APART_MM;
  }
  return null;
}

function segmentsCross(first: Edge, second: Edge): boolean {
  const d1 = cross(second.a, second.b, first.a);
  const d2 = cross(second.a, second.b, first.b);
  const d3 = cross(first.a, first.b, second.a);
  const d4 = cross(first.a, first.b, second.b);
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

function cross(from: Point, to: Point, point: Point): number {
  return (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x);
}

function toSegment(point: Point, edge: Edge): number {
  const dx = edge.b.x - edge.a.x;
  const dy = edge.b.y - edge.a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - edge.a.x) * dx + (point.y - edge.a.y) * dy) / lengthSquared),
        );
  return Math.hypot(point.x - (edge.a.x + t * dx), point.y - (edge.a.y + t * dy));
}

function boxOf(paths: PathsD): Box {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const path of paths) {
    for (const point of path) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

function boxesApart(boxes: ReadonlyArray<Box>): boolean {
  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      const first = boxes[a];
      const second = boxes[b];
      if (first !== undefined && second !== undefined && boxesMeet(first, second)) return false;
    }
  }
  return true;
}

function boxesMeet(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

function boxHolds(outer: Box, inner: Box): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

function joinBoxes(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
