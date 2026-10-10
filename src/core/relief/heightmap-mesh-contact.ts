// Exact cutter contact with a mesh relief's own triangles (ADR-580).
//
// The sampled map of an STL is only an approximation of the model: read at
// cell centres it misses detail between them, and read at each cell's highest
// point (ADR-412 Amendment 1) it rises above every slope by up to half a cell
// times the gradient, which finishing then leaves as stock. This field solves
// the cutter against the triangles themselves, the drop-cutter of 3-axis CAM:
//
//   tip(c) = max over triangles T and points p in T with |p - c| <= R of
//            h_T(p) - dz(|p - c|)
//
// with the same closed-form facet and edge solvers the triangulated heightmap
// uses (heightmap-surface-contact-geometry.ts). On each triangle the objective
// is concave, so its maximum is a facet contact on the uphill ray or lies on an
// edge (a corner when the edge's own maximum is at its end); where the rim of
// the cutter crosses the triangle, the best rim point is where the rim meets
// an edge. Triangles are read highest first per bin (heightmap-mesh-index.ts)
// and dropped once they stand no higher than the best tip so far.
//
// A 'top' background (stock kept where no triangle covers a cell centre) is a
// whole-cell block at the stock top. The floor background lies at the bottom
// of the relief and can never lift a tip above the map's own centre sample.

import { partialCellCenter } from '../grid';
import type { ToolKernel } from '../sim';
import type { Heightmap, HeightmapExactSurface } from './heightmap';
import { read64 } from './heightmap-surface-contact-element';
import {
  type ContactLaw,
  edgeContact,
  facetContact,
  PRUNE_TOLERANCE_MM,
} from './heightmap-surface-contact-geometry';
import { surfaceContactLaw } from './heightmap-surface-contact-law';
import type { MovePoint } from './heightmap-surface-contact-move';
import type { SurfaceContactField } from './heightmap-surface-contact-types';
import {
  binRange,
  boxDistance,
  FLOATS_PER_MESH_TRIANGLE,
  meshIndexFor,
  type MeshIndex,
} from './heightmap-mesh-index';

// Bins this many cells across: a query reads a handful of bins for any cutter
// the relief compiler pairs with its cell size.
const BIN_CELLS = 4;
const STAMP_LIMIT = 0x3fffffff;

type Box = { minX: number; maxX: number; minY: number; maxY: number };

type MeshContact = {
  readonly law: ContactLaw;
  readonly index: MeshIndex;
  readonly map: Heightmap;
  readonly uncoveredTop: Uint8Array | undefined;
  readonly seen: Int32Array;
  readonly scan: { best: number; count: number };
  stamp: number;
  candidates: Int32Array;
  candidateBound: Float64Array;
  kept: Int32Array;
  keptCount: number;
  keptBackground: boolean;
};

/** The exact contact field of one mesh relief map and cutter envelope. */
export function createMeshSurfaceContactField(
  map: Heightmap,
  surface: HeightmapExactSurface,
  kernel: ToolKernel,
): SurfaceContactField | null {
  const law = surfaceContactLaw(kernel);
  if (law === null || map.widthCells < 1 || map.heightCells < 1) return null;
  const index = meshIndexFor(surface.triangles, BIN_CELLS * map.mmPerCell);
  const xs = new Float64Array(map.widthCells);
  const ys = new Float64Array(map.heightCells);
  for (let i = 0; i < map.widthCells; i += 1) xs[i] = partialCellCenter(map, 'x', i);
  for (let j = 0; j < map.heightCells; j += 1) ys[j] = partialCellCenter(map, 'y', j);
  const contact: MeshContact = {
    law,
    index,
    map,
    uncoveredTop: surface.uncoveredTop,
    seen: new Int32Array(index.count),
    scan: { best: 0, count: 0 },
    stamp: 0,
    candidates: new Int32Array(64),
    candidateBound: new Float64Array(64),
    kept: new Int32Array(64),
    keptCount: 0,
    keptBackground: false,
  };
  const keptTip = (x: number, y: number, lowerBound: number): number =>
    keptContact(contact, x, y, lowerBound);
  const none = Number.POSITIVE_INFINITY;
  return {
    constraint: (cx, cy, lowerBound) =>
      pointContact(contact, read64(xs, cx), read64(ys, cy), lowerBound, none),
    constraintAtPoint: (x, y, lowerBound) => pointContact(contact, x, y, lowerBound, none),
    clearsAtPoint: (x, y, z, slackMm) => pointContact(contact, x, y, z, z + slackMm) <= z + slackMm,
    alongMove: (from, to, toleranceMm) =>
      collectMove(contact, from, to, toleranceMm) ? keptTip : null,
  };
}

// With `stopAbove`, the answer is exact only up to it: a contact higher than
// it is returned as soon as one is found.
function pointContact(
  c: MeshContact,
  x: number,
  y: number,
  lowerBound: number,
  stopAbove: number,
): number {
  const scan = c.scan;
  scan.best = backgroundContact(c, x, y, lowerBound);
  scan.count = 0;
  if (scan.best > stopAbove) return scan.best;
  const r = c.law.radiusMm;
  const range = binRange(c.index, x - r, x + r, y - r, y + r);
  const stamp = nextStamp(c);
  for (let by = range.minY; by <= range.maxY; by += 1) {
    for (let bx = range.minX; bx <= range.maxX; bx += 1) {
      scanBin(c, by * c.index.binsX + bx, x, y, stamp, stopAbove);
      if (scan.best > stopAbove) return scan.best;
    }
  }
  return refineEdges(c, x, y, stopAbove);
}

function scanBin(
  c: MeshContact,
  bin: number,
  x: number,
  y: number,
  stamp: number,
  stopAbove: number,
): void {
  const { index, seen, scan } = c;
  const end = index.binStart[bin + 1] ?? 0;
  for (let k = index.binStart[bin] ?? 0; k < end; k += 1) {
    const t = index.binTriangles[k] ?? 0;
    const top = read64(index.top, t);
    // Highest first: nothing later in this bin can lift the tip.
    if (!(top > scan.best + PRUNE_TOLERANCE_MM)) return;
    if (seen[t] === stamp) continue;
    seen[t] = stamp;
    considerTriangle(c, t, top, x, y);
    if (scan.best > stopAbove) return;
  }
}

// Solves triangle t's facet now and keeps it for the edge pass while its
// bound still allows a higher contact.
function considerTriangle(c: MeshContact, t: number, top: number, x: number, y: number): void {
  const near = boxDistance(c.index, t, x, y);
  if (near > c.law.radiusMm) return;
  const scan = c.scan;
  const bound = top - c.law.dz(near);
  if (!(bound > scan.best + PRUNE_TOLERANCE_MM)) return;
  const plane = facetAt(c, t, x, y) ? c.law.facet.planeBound : Number.POSITIVE_INFINITY;
  if (c.law.facet.candidate > scan.best && plane !== Number.POSITIVE_INFINITY) {
    scan.best = c.law.facet.candidate;
  }
  const edgeBound = Math.min(bound, plane);
  if (edgeBound > scan.best + PRUNE_TOLERANCE_MM) pushCandidate(c, t, edgeBound);
}

function refineEdges(c: MeshContact, x: number, y: number, stopAbove: number): number {
  const scan = c.scan;
  for (let k = 0; k < scan.count; k += 1) {
    if (!(read64(c.candidateBound, k) > scan.best + PRUNE_TOLERANCE_MM)) continue;
    scan.best = triangleEdges(c, c.candidates[k] ?? 0, x, y, scan.best);
    if (scan.best > stopAbove) return scan.best;
  }
  return scan.best;
}

// Writes the facet result to law.facet; false for a triangle with no plan area
// (a vertical wall), whose edges must then be searched.
function facetAt(c: MeshContact, t: number, x: number, y: number): boolean {
  const tr = c.index.triangles;
  const at = t * FLOATS_PER_MESH_TRIANGLE;
  return facetContact(
    c.law,
    read64(tr, at),
    read64(tr, at + 1),
    read64(tr, at + 2),
    read64(tr, at + 3),
    read64(tr, at + 4),
    read64(tr, at + 5),
    read64(tr, at + 6),
    read64(tr, at + 7),
    read64(tr, at + 8),
    x,
    y,
  );
}

function triangleEdges(c: MeshContact, t: number, x: number, y: number, best: number): number {
  const tr = c.index.triangles;
  const at = t * FLOATS_PER_MESH_TRIANGLE;
  let result = best;
  for (let edge = 0; edge < 3; edge += 1) {
    const p = at + edge * 3;
    const q = at + ((edge + 1) % 3) * 3;
    if (read64(tr, p) === read64(tr, q) && read64(tr, p + 1) === read64(tr, q + 1)) {
      // An edge with no plan length (a vertical needle, or a point) touches
      // the cutter only at its higher end.
      result = vertexContact(c.law, tr, p, q, x, y, result);
      continue;
    }
    result = edgeContact(
      c.law,
      read64(tr, p),
      read64(tr, p + 1),
      read64(tr, p + 2),
      read64(tr, q),
      read64(tr, q + 1),
      read64(tr, q + 2),
      x,
      y,
      result,
    );
  }
  return result;
}

function vertexContact(
  law: ContactLaw,
  tr: Float64Array,
  p: number,
  q: number,
  x: number,
  y: number,
  best: number,
): number {
  const dx = read64(tr, p) - x;
  const dy = read64(tr, p + 1) - y;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared > law.radiusSquared) return best;
  const z = Math.max(read64(tr, p + 2), read64(tr, q + 2));
  return Math.max(best, z - law.dz(Math.sqrt(distanceSquared)));
}

// Stock-top blocks of a 'top' background: the cutter rests on the nearest
// point of each uncovered cell within its reach.
function backgroundContact(c: MeshContact, x: number, y: number, lowerBound: number): number {
  const blocks = c.uncoveredTop;
  if (blocks === undefined || !(lowerBound < 0)) return lowerBound;
  return backgroundOverBox(c, blocks, { minX: x, maxX: x, minY: y, maxY: y }, lowerBound);
}

// The highest the background can hold a cutter whose axis lies in `box`, at
// the box's nearest approach to each block, or `lowerBound`.
function backgroundOverBox(
  c: MeshContact,
  blocks: Uint8Array,
  box: Box,
  lowerBound: number,
): number {
  const { map, law } = c;
  const mm = map.mmPerCell;
  const r = law.radiusMm;
  const i0 = Math.max(0, Math.floor((box.minX - r) / mm));
  const i1 = Math.min(map.widthCells - 1, Math.floor((box.maxX + r) / mm));
  const j0 = Math.max(0, Math.floor((box.minY - r) / mm));
  const j1 = Math.min(map.heightCells - 1, Math.floor((box.maxY + r) / mm));
  let best = lowerBound;
  for (let j = j0; j <= j1; j += 1) {
    const dy = Math.max(j * mm - box.maxY, 0, box.minY - Math.min((j + 1) * mm, map.heightMm));
    for (let i = i0; i <= i1; i += 1) {
      if (blocks[j * map.widthCells + i] !== 1) continue;
      const dx = Math.max(i * mm - box.maxX, 0, box.minX - Math.min((i + 1) * mm, map.widthMm));
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > law.radiusSquared) continue;
      best = Math.max(best, -law.dz(Math.sqrt(distanceSquared)));
      if (best >= 0) return best;
    }
  }
  return best;
}

// Keeps the triangles that might lift the tip more than the tolerance above
// the straight move anywhere on it. A triangle's contact never rises above its
// whole plane's, which is linear in the cutter's axis, so a plane within the
// tolerance of the move at both ends stays within it all along.
function collectMove(c: MeshContact, from: MovePoint, to: MovePoint, toleranceMm: number): boolean {
  const box = {
    minX: Math.min(from.x, to.x),
    maxX: Math.max(from.x, to.x),
    minY: Math.min(from.y, to.y),
    maxY: Math.max(from.y, to.y),
  };
  const low = Math.min(from.z, to.z) + toleranceMm;
  c.keptCount = 0;
  c.keptBackground =
    c.uncoveredTop !== undefined &&
    low < 0 &&
    backgroundOverBox(c, c.uncoveredTop, box, Number.NEGATIVE_INFINITY) > low;
  const r = c.law.radiusMm;
  const range = binRange(c.index, box.minX - r, box.maxX + r, box.minY - r, box.maxY + r);
  const stamp = nextStamp(c);
  for (let by = range.minY; by <= range.maxY; by += 1) {
    for (let bx = range.minX; bx <= range.maxX; bx += 1) {
      keepFromBin(c, by * c.index.binsX + bx, box, low, { from, to, toleranceMm }, stamp);
    }
  }
  return c.keptCount > 0 || c.keptBackground;
}

type Move = { readonly from: MovePoint; readonly to: MovePoint; readonly toleranceMm: number };

function keepFromBin(
  c: MeshContact,
  bin: number,
  box: Box,
  low: number,
  move: Move,
  stamp: number,
): void {
  const { index, law, seen } = c;
  const end = index.binStart[bin + 1] ?? 0;
  for (let k = index.binStart[bin] ?? 0; k < end; k += 1) {
    const t = index.binTriangles[k] ?? 0;
    const top = read64(index.top, t);
    if (!(top > low)) return;
    if (seen[t] === stamp) continue;
    seen[t] = stamp;
    const near = boxToBox(index, t, box);
    if (near > law.radiusMm || !(top - law.dz(near) > low)) continue;
    if (planeRises(c, t, move)) pushKept(c, t);
  }
}

function planeRises(c: MeshContact, t: number, move: Move): boolean {
  const { from, to, toleranceMm } = move;
  if (!facetAt(c, t, from.x, from.y)) return true;
  if (!(c.law.facet.planeBound <= from.z + toleranceMm)) return true;
  facetAt(c, t, to.x, to.y);
  return !(c.law.facet.planeBound <= to.z + toleranceMm);
}

// pointContact over only the kept triangles and, when it can matter, the
// background.
function keptContact(c: MeshContact, x: number, y: number, lowerBound: number): number {
  const scan = c.scan;
  scan.best = c.keptBackground ? backgroundContact(c, x, y, lowerBound) : lowerBound;
  scan.count = 0;
  for (let k = 0; k < c.keptCount; k += 1) {
    const t = c.kept[k] ?? 0;
    const top = read64(c.index.top, t);
    if (top > scan.best + PRUNE_TOLERANCE_MM) considerTriangle(c, t, top, x, y);
  }
  return refineEdges(c, x, y, Number.POSITIVE_INFINITY);
}

function boxToBox(index: MeshIndex, t: number, box: Box): number {
  const at = t * 4;
  const dx = Math.max(0, read64(index.box, at) - box.maxX, box.minX - read64(index.box, at + 1));
  const dy = Math.max(
    0,
    read64(index.box, at + 2) - box.maxY,
    box.minY - read64(index.box, at + 3),
  );
  return Math.sqrt(dx * dx + dy * dy);
}

function nextStamp(c: MeshContact): number {
  if (c.stamp >= STAMP_LIMIT) {
    c.seen.fill(0);
    c.stamp = 0;
  }
  c.stamp += 1;
  return c.stamp;
}

function pushCandidate(c: MeshContact, t: number, bound: number): void {
  const count = c.scan.count;
  if (count === c.candidates.length) {
    const candidates = new Int32Array(count * 2);
    candidates.set(c.candidates);
    c.candidates = candidates;
    const bounds = new Float64Array(count * 2);
    bounds.set(c.candidateBound);
    c.candidateBound = bounds;
  }
  c.candidates[count] = t;
  c.candidateBound[count] = bound;
  c.scan.count = count + 1;
}

function pushKept(c: MeshContact, t: number): void {
  if (c.keptCount === c.kept.length) {
    const kept = new Int32Array(c.keptCount * 2);
    kept.set(c.kept);
    c.kept = kept;
  }
  c.kept[c.keptCount] = t;
  c.keptCount += 1;
}
