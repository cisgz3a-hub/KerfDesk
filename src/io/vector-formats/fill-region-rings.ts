// Filled-region rings for GeoJSON (ADR-444): which closed contours of one
// painted item bound its filled region, and which outer ring each hole
// belongs to, under the item's own fill rule.
//
// Rings are integer grid polygons (the GeoJSON writer's snapped contours), so
// every orientation and point-in-ring test here is exact. For rings that are
// pairwise nested or disjoint, the winding number of any point is the sum of
// the orientations (+1 / -1) of the rings that contain it, and its even-odd
// count is the number of those rings. A ring bounds the painted region
// exactly when "filled" differs on its two sides:
//
//   outside value w, inside value w + s   (nonzero: signed sum, s = +-1)
//   outside count c, inside count c + 1   (even-odd)
//
// A bounding ring with the fill on its inside is an outer ring; one with the
// fill on its outside is a hole of the nearest enclosing bounding ring, which
// is then necessarily an outer ring. Rings that do not bound the region (a
// same-winding contour nested in another under nonzero) are dropped.
//
// Crossing contours (or a self-crossing one) break the nesting model, and so
// do contours whose containment cannot be decided (duplicates). They are not
// merged by a polygon union here: the result is marked `crossing`, and the
// writer then keeps each polygon as its own feature instead of claiming a
// valid MultiPolygon.

import type { GridPoint } from './vector-artwork';

export type RegionFillRule = 'evenodd' | 'nonzero';

export type RegionPolygon = {
  /** Index of the outer ring in the input. */
  readonly outer: number;
  /** Indices of its holes, in input order. */
  readonly holes: ReadonlyArray<number>;
};

export type FillRegion = {
  readonly polygons: ReadonlyArray<RegionPolygon>;
  /** Some contours cross (or cannot be ordered by containment). */
  readonly crossing: boolean;
};

type RingInfo = {
  readonly index: number;
  readonly points: ReadonlyArray<GridPoint>;
  readonly twiceArea: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/**
 * Rings are open (the first point is not repeated), have at least three
 * points and are not collinear. Output polygons keep input order of outers.
 */
export function fillRegionPolygons(
  rings: ReadonlyArray<ReadonlyArray<GridPoint>>,
  fillRule: RegionFillRule,
): FillRegion {
  const infos = rings.map(ringInfo);
  const nesting = nestRings(infos);
  const role = ringRoles(infos, nesting, fillRule);
  const { polygons, orphanHole } = assignHoles(infos, nesting, role);
  const undecided = [...nesting.values()].some((entry) => entry.undecided);
  const zeroNetArea = infos.some((ring) => ring.twiceArea === 0);
  return { polygons, crossing: zeroNetArea || orphanHole || undecided || ringsCross(infos) };
}

type Nesting = {
  /** Smallest containing ring, or null. */
  readonly parent: number | null;
  /** Sum of the containing rings' orientations (+1 counterclockwise). */
  readonly winding: number;
  /** Number of containing rings. */
  readonly count: number;
  /** Some containment against a larger ring could not be decided. */
  readonly undecided: boolean;
};

function nestRings(infos: ReadonlyArray<RingInfo>): Map<number, Nesting> {
  const bySize = [...infos].sort(
    (a, b) => Math.abs(b.twiceArea) - Math.abs(a.twiceArea) || a.index - b.index,
  );
  const nesting = new Map<number, Nesting>();
  bySize.forEach((ring, order) => {
    let best: RingInfo | null = null;
    let winding = 0;
    let count = 0;
    let undecided = false;
    for (let k = 0; k < order; k += 1) {
      const candidate = bySize[k] as RingInfo;
      if (!boxContains(candidate, ring)) continue;
      const inside = ringInside(ring, candidate);
      undecided ||= inside === null;
      if (inside !== true) continue;
      winding += Math.sign(candidate.twiceArea);
      count += 1;
      // Sorted largest first, so the last container found is the smallest.
      best = candidate;
    }
    nesting.set(ring.index, { parent: best?.index ?? null, winding, count, undecided });
  });
  return nesting;
}

/** Each hole joins the nearest enclosing bounding ring, which is an outer ring. */
function assignHoles(
  infos: ReadonlyArray<RingInfo>,
  nesting: ReadonlyMap<number, Nesting>,
  role: ReadonlyMap<number, 'outer' | 'hole'>,
): { polygons: RegionPolygon[]; orphanHole: boolean } {
  const holes = new Map<number, number[]>();
  let orphanHole = false;
  for (const ring of infos) if (role.get(ring.index) === 'outer') holes.set(ring.index, []);
  for (const ring of infos) {
    if (role.get(ring.index) !== 'hole') continue;
    const owner = boundingAncestor(ring.index, nesting, role);
    const list = owner === null ? undefined : holes.get(owner);
    if (list === undefined) {
      // Only reachable when the nesting model is broken; keep the ring visible.
      orphanHole = true;
      holes.set(ring.index, []);
    } else list.push(ring.index);
  }
  const polygons = [...holes.entries()]
    .sort(([a], [b]) => a - b)
    .map(([outer, list]) => ({ outer, holes: list }));
  return { polygons, orphanHole };
}

/** The nearest enclosing ring that bounds the filled region, or null. */
function boundingAncestor(
  index: number,
  nesting: ReadonlyMap<number, Nesting>,
  role: ReadonlyMap<number, 'outer' | 'hole'>,
): number | null {
  let owner = nesting.get(index)?.parent ?? null;
  while (owner !== null && !role.has(owner)) owner = nesting.get(owner)?.parent ?? null;
  return owner;
}

/** Rings that bound the filled region, as outer rings or holes. */
function ringRoles(
  infos: ReadonlyArray<RingInfo>,
  nesting: ReadonlyMap<number, Nesting>,
  fillRule: RegionFillRule,
): Map<number, 'outer' | 'hole'> {
  const evenOdd = fillRule === 'evenodd';
  const filled = (value: number): boolean => (evenOdd ? value % 2 !== 0 : value !== 0);
  const role = new Map<number, 'outer' | 'hole'>();
  for (const ring of infos) {
    // A bowtie's opposite-winding lobes cancel its net area but still paint.
    // The nesting model cannot assign it one orientation. Keep the contour
    // as an unmerged feature under both fill rules, with the crossing warning.
    if (ring.twiceArea === 0) {
      role.set(ring.index, 'outer');
      continue;
    }
    const entry = nesting.get(ring.index);
    const outside = (evenOdd ? entry?.count : entry?.winding) ?? 0;
    const inside = outside + (evenOdd ? 1 : Math.sign(ring.twiceArea));
    if (filled(outside) !== filled(inside)) role.set(ring.index, filled(inside) ? 'outer' : 'hole');
  }
  return role;
}

/** Twice the signed area (shoelace) of an open integer ring; positive = counterclockwise, y up. */
export function twiceSignedArea(ring: ReadonlyArray<GridPoint>): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i] as GridPoint;
    const b = ring[(i + 1) % ring.length] as GridPoint;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

function ringInfo(points: ReadonlyArray<GridPoint>, index: number): RingInfo {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { index, points, twiceArea: twiceSignedArea(points), minX, minY, maxX, maxY };
}

function boxContains(outer: RingInfo, inner: RingInfo): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

/**
 * Whether `inner` lies inside `outer`: decided by the first vertex (then edge
 * midpoint) not on `outer`'s boundary; null when every probe is on it.
 */
function ringInside(inner: RingInfo, outer: RingInfo): boolean | null {
  const n = inner.points.length;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = inner.points[i] as GridPoint;
      const b = inner.points[(i + 1) % n] as GridPoint;
      // Midpoints in doubled coordinates keep the test in integers.
      const probe = pass === 0 ? { x: 2 * a.x, y: 2 * a.y } : { x: a.x + b.x, y: a.y + b.y };
      const side = classify(probe, outer.points);
      if (side !== 'boundary') return side === 'inside';
    }
  }
  return null;
}

/** Nonzero winding test of a doubled-coordinate probe against a ring. */
function classify(p: GridPoint, ring: ReadonlyArray<GridPoint>): 'inside' | 'outside' | 'boundary' {
  let wn = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const r0 = ring[i] as GridPoint;
    const r1 = ring[(i + 1) % ring.length] as GridPoint;
    const a = { x: 2 * r0.x, y: 2 * r0.y };
    const b = { x: 2 * r1.x, y: 2 * r1.y };
    const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
    if (cross === 0 && withinBox(p, a, b)) return 'boundary';
    if (a.y <= p.y) {
      if (b.y > p.y && cross > 0) wn += 1;
    } else if (b.y <= p.y && cross < 0) wn -= 1;
  }
  return wn !== 0 ? 'inside' : 'outside';
}

function withinBox(p: GridPoint, a: GridPoint, b: GridPoint): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

type Edge = {
  readonly ring: number;
  readonly a: GridPoint;
  readonly b: GridPoint;
};

/**
 * Whether any two edges cross properly (each strictly separates the other's
 * endpoints). Touching at a vertex or along a shared line is not a crossing.
 * Edges are bucketed on a uniform grid so dense traced layers stay near
 * linear; a pair is tested in every cell the two edges share.
 */
function ringsCross(rings: ReadonlyArray<RingInfo>): boolean {
  const edges: Edge[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    const n = ring.points.length;
    for (let i = 0; i < n; i += 1) {
      edges.push({
        ring: ring.index,
        a: ring.points[i] as GridPoint,
        b: ring.points[(i + 1) % n] as GridPoint,
      });
    }
    minX = Math.min(minX, ring.minX);
    minY = Math.min(minY, ring.minY);
    maxX = Math.max(maxX, ring.maxX);
    maxY = Math.max(maxY, ring.maxY);
  }
  if (edges.length < 2) return false;
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const cellsPerSide = Math.max(1, Math.min(4096, Math.ceil(Math.sqrt(edges.length))));
  const cell = span / cellsPerSide;
  const column = (x: number): number => Math.min(cellsPerSide - 1, Math.floor((x - minX) / cell));
  const row = (y: number): number => Math.min(cellsPerSide - 1, Math.floor((y - minY) / cell));
  const buckets = new Map<number, number[]>();
  edges.forEach((edge, index) => {
    const c0 = column(Math.min(edge.a.x, edge.b.x));
    const c1 = column(Math.max(edge.a.x, edge.b.x));
    const r0 = row(Math.min(edge.a.y, edge.b.y));
    const r1 = row(Math.max(edge.a.y, edge.b.y));
    for (let c = c0; c <= c1; c += 1) {
      for (let r = r0; r <= r1; r += 1) {
        const key = c * cellsPerSide + r;
        const bucket = buckets.get(key);
        if (bucket === undefined) buckets.set(key, [index]);
        else bucket.push(index);
      }
    }
  });
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      const e = edges[bucket[i] as number] as Edge;
      for (let j = i + 1; j < bucket.length; j += 1) {
        if (properCross(e, edges[bucket[j] as number] as Edge)) return true;
      }
    }
  }
  return false;
}

function properCross(e: Edge, f: Edge): boolean {
  const d1 = orient(e.a, e.b, f.a);
  const d2 = orient(e.a, e.b, f.b);
  const d3 = orient(f.a, f.b, e.a);
  const d4 = orient(f.a, f.b, e.b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function orient(a: GridPoint, b: GridPoint, c: GridPoint): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}
