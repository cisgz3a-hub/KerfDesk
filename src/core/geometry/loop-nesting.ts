// Nearest-container search for non-crossing closed loops (ADR-398).
//
// Pairwise point-in-polygon tests are quadratic in boundary length: on a
// dense trace (the 1254 px owl, about 2,200 loops) nearly every small loop
// sits inside the bounding box of the large body outline, and each test walks
// that whole outline (5.4 s measured). Instead, every edge goes once into thin
// horizontal bands, and each probe casts the same rightward ray
// `pointInPolygon` uses against only the edges of its band, learning at once
// which loops contain it.
//
// A trace boundary may touch a neighbour at a pixel corner, so a probe can
// land on another loop. Up to nine probes spread along each loop vote, and a
// probe on a candidate's boundary abstains for that candidate. Three probes
// run first; the rest run only when those touch something or disagree.
// When every vertex touches some candidate (a hole whose corners all sit on
// its outer), edge midpoints nudged just inside the loop vote as well.

import type { Vec2 } from '../scene';
import { pointInPolygon } from './point-in-polygon';

export type NestingLoop = {
  readonly points: ReadonlyArray<Vec2>;
  readonly area: number;
  readonly minY: number;
  readonly maxY: number;
  // Distance under which a probe counts as on this loop's boundary.
  readonly eps: number;
};

type EdgeIndex = {
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  readonly bx: Float64Array;
  readonly by: Float64Array;
  readonly rightX: Float64Array;
  readonly loop: Int32Array;
  readonly bands: ReadonlyArray<Int32Array>;
  readonly minY: number;
  readonly bandHeight: number;
  readonly eps: number;
};

type ProbeResult = { readonly inside: Set<number>; readonly boundary: Set<number> };

const PROBES_PER_LOOP = 9;
// Interior probes sit this fraction of an edge's length inside the loop.
const INTERIOR_NUDGE = 1e-3;
const QUICK_PROBES = [0, 3, 6];
// Bands a quarter of the mean edge height tall: each edge lands in a few
// bands and each band holds little beyond the edges near its probe.
const BANDS_PER_MEAN_EDGE_HEIGHT = 4;
const MAX_BANDS = 16_384;

/** For each loop, the index of its smallest strictly larger container, or -1. */
export function nearestContainers(loops: ReadonlyArray<NestingLoop>): ReadonlyArray<number> {
  if (loops.length < 2) return loops.map(() => -1);
  const index = buildEdgeIndex(loops);
  return loops.map((loop, loopIndex) => nearestContainer(loops, index, loop, loopIndex));
}

function nearestContainer(
  loops: ReadonlyArray<NestingLoop>,
  index: EdgeIndex,
  loop: NestingLoop,
  loopIndex: number,
): number {
  const points = probePoints(loop);
  const probe = (point: Vec2): ProbeResult => probeLoops(index, point, loopIndex);
  const quickResults = QUICK_PROBES.flatMap((at) => {
    const point = points[at];
    return point === undefined ? [] : [probe(point)];
  });
  const settled = quickResults.length === points.length || unanimous(quickResults);
  const probes = settled
    ? quickResults
    : points.map((point, at) => quickResults[QUICK_PROBES.indexOf(at)] ?? probe(point));
  if (!someCandidateAbstainedEverywhere(probes)) return votedParent(loops, loop, probes);
  // Every vertex probe touched some candidate's boundary (a hole whose
  // corners all sit on its outer). Those abstentions leave the candidate no
  // vote at all, so add probes just inside this loop, off its vertices.
  const interior = interiorProbePoints(loop).map(probe);
  return votedParent(loops, loop, [...probes, ...interior]);
}

function someCandidateAbstainedEverywhere(probes: ReadonlyArray<ProbeResult>): boolean {
  const [first, ...rest] = probes;
  if (first === undefined) return false;
  for (const candidate of first.boundary) {
    if (rest.every((result) => result.boundary.has(candidate))) return true;
  }
  return false;
}

// Probes that touch nothing and agree on every container settle the vote.
function unanimous(results: ReadonlyArray<ProbeResult>): boolean {
  const first = results[0];
  if (first === undefined) return false;
  return results.every(
    (result) =>
      result.boundary.size === 0 &&
      result.inside.size === first.inside.size &&
      [...result.inside].every((candidate) => first.inside.has(candidate)),
  );
}

function votedParent(
  loops: ReadonlyArray<NestingLoop>,
  loop: NestingLoop,
  probes: ReadonlyArray<ProbeResult>,
): number {
  const insideVotes = new Map<number, number>();
  for (const probe of probes) {
    for (const candidate of probe.inside) {
      insideVotes.set(candidate, (insideVotes.get(candidate) ?? 0) + 1);
    }
  }
  let parent = -1;
  for (const [candidate, inside] of insideVotes) {
    const container = loops[candidate] as NestingLoop;
    if (container.area <= loop.area) continue;
    const abstained = probes.filter((probe) => probe.boundary.has(candidate)).length;
    if (inside <= probes.length - inside - abstained) continue;
    if (parent < 0 || container.area < (loops[parent] as NestingLoop).area) parent = candidate;
  }
  return parent;
}

function probePoints(loop: NestingLoop): ReadonlyArray<Vec2> {
  const step = Math.max(1, Math.floor(loop.points.length / PROBES_PER_LOOP));
  const probes: Vec2[] = [];
  for (let i = 0; i < loop.points.length && probes.length < PROBES_PER_LOOP; i += step) {
    probes.push(loop.points[i] as Vec2);
  }
  return probes;
}

// Edge midpoints nudged a small fraction of the edge length to the loop's
// inside. A point strictly inside a loop is inside every loop that contains
// it, and on the boundary only of a container that shares that very edge.
// Loops nested inside this one may also claim it; they are smaller, and
// `votedParent` only considers larger candidates.
function interiorProbePoints(loop: NestingLoop): ReadonlyArray<Vec2> {
  const { points } = loop;
  const step = Math.max(1, Math.floor(points.length / PROBES_PER_LOOP));
  const probes: Vec2[] = [];
  for (let i = 0; i < points.length && probes.length < PROBES_PER_LOOP; i += step) {
    const a = points[i] as Vec2;
    const b = points[(i + 1) % points.length] as Vec2;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const nx = (a.y - b.y) * INTERIOR_NUDGE;
    const ny = (b.x - a.x) * INTERIOR_NUDGE;
    if (nx === 0 && ny === 0) continue;
    const left = { x: mid.x + nx, y: mid.y + ny };
    const right = { x: mid.x - nx, y: mid.y - ny };
    if (pointInPolygon(left, points)) probes.push(left);
    else if (pointInPolygon(right, points)) probes.push(right);
  }
  return probes;
}

function probeLoops(index: EdgeIndex, probe: Vec2, self: number): ProbeResult {
  const parity = new Set<number>();
  const boundary = new Set<number>();
  const edges = index.bands[bandOf(index, probe.y, index.bands.length)] ?? new Int32Array(0);
  const { eps } = index;
  const leftLimit = probe.x - eps;
  for (const edge of edges) {
    // Wholly left of the probe: cannot cross the rightward ray or touch it.
    if ((index.rightX[edge] as number) < leftLimit) continue;
    const owner = index.loop[edge] as number;
    if (owner === self) continue;
    const ax = index.ax[edge] as number;
    const ay = index.ay[edge] as number;
    const bx = index.bx[edge] as number;
    const by = index.by[edge] as number;
    if (nearSegment(probe, ax, ay, bx, by, eps)) {
      boundary.add(owner);
      continue;
    }
    // Same half-open crossing rule as pointInPolygon.
    if (ay > probe.y === by > probe.y) continue;
    if (probe.x < ((bx - ax) * (probe.y - ay)) / (by - ay) + ax) {
      if (!parity.delete(owner)) parity.add(owner);
    }
  }
  for (const owner of boundary) parity.delete(owner);
  return { inside: parity, boundary };
}

function buildEdgeIndex(loops: ReadonlyArray<NestingLoop>): EdgeIndex {
  const edgeCount = loops.reduce((count, loop) => count + loop.points.length, 0);
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let eps = 0;
  for (const loop of loops) {
    minY = Math.min(minY, loop.minY);
    maxY = Math.max(maxY, loop.maxY);
    eps = Math.max(eps, loop.eps);
  }
  const span = maxY - minY;
  const idealBands = (BANDS_PER_MEAN_EDGE_HEIGHT * span) / meanEdgeHeight(loops, edgeCount);
  const bandCount = Math.max(
    1,
    Math.min(MAX_BANDS, Math.ceil(Math.max(Math.sqrt(edgeCount), idealBands || 1))),
  );
  const buckets: number[][] = Array.from({ length: bandCount }, () => []);
  const index = {
    ax: new Float64Array(edgeCount),
    ay: new Float64Array(edgeCount),
    bx: new Float64Array(edgeCount),
    by: new Float64Array(edgeCount),
    rightX: new Float64Array(edgeCount),
    loop: new Int32Array(edgeCount),
    minY,
    bandHeight: span > 0 ? span / bandCount : 1,
    eps,
  };
  let edge = 0;
  loops.forEach((loop, loopIndex) => {
    const { points } = loop;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const a = points[j] as Vec2;
      const b = points[i] as Vec2;
      index.ax[edge] = a.x;
      index.ay[edge] = a.y;
      index.bx[edge] = b.x;
      index.by[edge] = b.y;
      index.rightX[edge] = Math.max(a.x, b.x);
      index.loop[edge] = loopIndex;
      const first = bandOf(index, Math.min(a.y, b.y) - eps, bandCount);
      const last = bandOf(index, Math.max(a.y, b.y) + eps, bandCount);
      for (let band = first; band <= last; band += 1) buckets[band]?.push(edge);
      edge += 1;
    }
  });
  return { ...index, bands: buckets.map((bucket) => Int32Array.from(bucket)) };
}

function meanEdgeHeight(loops: ReadonlyArray<NestingLoop>, edgeCount: number): number {
  let total = 0;
  for (const { points } of loops) {
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      total += Math.abs((points[i] as Vec2).y - (points[j] as Vec2).y);
    }
  }
  return edgeCount > 0 ? total / edgeCount : 0;
}

function bandOf(
  index: { readonly minY: number; readonly bandHeight: number },
  y: number,
  bandCount: number,
): number {
  const band = Math.floor((y - index.minY) / index.bandHeight);
  return Math.max(0, Math.min(bandCount - 1, band));
}

function nearSegment(
  p: Vec2,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  eps: number,
): boolean {
  if (p.y < Math.min(ay, by) - eps || p.y > Math.max(ay, by) + eps) return false;
  if (p.x < Math.min(ax, bx) - eps || p.x > Math.max(ax, bx) + eps) return false;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / lengthSquared));
  const x = ax + t * dx - p.x;
  const y = ay + t * dy - p.y;
  return x * x + y * y <= eps * eps;
}
