// The cut lines and closed rings of a prepared laser job, as laser leads see
// them (ADR-626), and which side of each closed contour is scrap.
//
// Every segment of every Line cut group is a line a lead must keep clear of.
// Every closed segment is a ring. A contour that tabs or perforation broke into
// pieces is a ring too: its pieces carry the contour's topology identity
// (ADR-486 Amd 2), so they are chained back into the outline they still cut,
// across the cut group and its tab-span group. Without that, a hole inside a
// tabbed outline on another operation would read as an outer contour, and its
// lead would run into the part.
//
// The scrap side is the containment parity inside-first ordering uses
// (containment-depth.ts): a contour inside an even number of rings is an
// outer contour, its scrap outside; inside an odd number, a hole, its scrap
// inside. Copies of one outline (the same shape cut by two operations) count
// once, or a hole inside a twice-cut outline would read as an outer contour.
// Containment is judged from the outlines alone here: the depth compile
// carries already counts a container on the same path, which may also have a
// copy on another operation.

import type { Vec2 } from '../scene';
import { containmentDepths } from './containment-depth';
import type { CutSegment, Job } from './job';
import type { LeadRing } from './laser-lead-obstacles';
import { polylineBounds } from './segment-bounds';

export type LeadJobLines = {
  /** Every cut line, by line id. */
  readonly lines: ReadonlyArray<ReadonlyArray<Vec2>>;
  /** Line id of each Line cut segment, keyed by `group:segment`. */
  readonly lineOf: ReadonlyMap<string, number>;
  readonly rings: ReadonlyArray<LeadRing>;
  /** Ring id of each closed segment's line. */
  readonly ringOfLine: ReadonlyMap<number, number>;
  /** Containment depth of each ring, copies counted once. */
  readonly depths: ReadonlyArray<number>;
  /** The other rings that are copies of each ring. */
  readonly copies: ReadonlyArray<ReadonlyArray<number>>;
};

// Two rings are one outline cut twice when their bounds and lengths agree to
// within this.
const COPY_MM = 0.01;
const COPY_LENGTH_RELATIVE = 1e-4;
// Copies are looked up by their lower-left corner on a grid this fine.
const COPY_CELL_MM = 0.1;

// A ring chained from more pieces than this is left out of containment: one
// contour cut as thousands of dashes is too costly to chain and rare.
const MAX_CHAINED_PIECES = 2000;

export function leadJobLines(job: Job): LeadJobLines {
  const lines: Array<ReadonlyArray<Vec2>> = [];
  const lineOf = new Map<string, number>();
  const rings: LeadRing[] = [];
  const ringOfLine = new Map<number, number>();
  const pieces = new Map<string, { nesting: NonNullable<CutSegment['nesting']>; ids: number[] }>();
  job.groups.forEach((group, groupIndex) => {
    if (group.kind !== 'cut') return;
    group.segments.forEach((segment, segmentIndex) => {
      const lineId = lines.length;
      lines.push(segment.polyline);
      lineOf.set(`${groupIndex}:${segmentIndex}`, lineId);
      if (segment.closed) {
        ringOfLine.set(lineId, rings.length);
        rings.push(ring(segment.polyline, [lineId], segment.nesting));
        return;
      }
      const nesting = segment.nesting;
      if (nesting?.topologyContour === undefined) return;
      const key = `${nesting.forest}\u0000${nesting.topologyContour}`;
      const entry = pieces.get(key);
      if (entry === undefined) pieces.set(key, { nesting, ids: [lineId] });
      else entry.ids.push(lineId);
    });
  });
  for (const { nesting, ids } of pieces.values()) {
    if (ids.length > MAX_CHAINED_PIECES) continue;
    const outline = chainPieces(ids.map((id) => lines[id] ?? []));
    if (outline.length >= 3) rings.push(ring(outline, ids, nesting));
  }
  const representatives = copyRepresentatives(rings);
  return {
    lines,
    lineOf,
    rings,
    ringOfLine,
    depths: scrapDepths(rings, representatives),
    copies: copyLists(representatives),
  };
}

function scrapDepths(
  rings: ReadonlyArray<LeadRing>,
  representatives: ReadonlyArray<number>,
): number[] {
  const unique = rings.flatMap((_, index) => (representatives[index] === index ? [index] : []));
  const depths = containmentDepths(
    unique.map((index) => ({ polyline: rings[index]?.points ?? [], closed: true })),
    { strict: true },
  );
  const byRepresentative = new Map(unique.map((index, at) => [index, depths[at] ?? 0]));
  return rings.map((_, index) => byRepresentative.get(representatives[index] ?? index) ?? 0);
}

/** For each ring, the first ring in job order it is a copy of, through any
 * chain of copies; the ring itself when it is the first. */
function copyRepresentatives(rings: ReadonlyArray<LeadRing>): number[] {
  const cells = new Map<string, number[]>();
  const representatives: number[] = [];
  const cellOf = (value: number): number => Math.round(value / COPY_CELL_MM);
  rings.forEach((ring, index) => {
    const cx = cellOf(ring.bounds.minX);
    const cy = cellOf(ring.bounds.minY);
    const copy = earlierCopy(ring, rings, cells, cx, cy);
    representatives.push(copy === null ? index : (representatives[copy] ?? copy));
    const key = `${cx},${cy}`;
    const list = cells.get(key);
    if (list === undefined) cells.set(key, [index]);
    else list.push(index);
  });
  return representatives;
}

function earlierCopy(
  ring: LeadRing,
  rings: ReadonlyArray<LeadRing>,
  cells: ReadonlyMap<string, ReadonlyArray<number>>,
  cx: number,
  cy: number,
): number | null {
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (const other of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
        const candidate = rings[other];
        if (candidate !== undefined && ringsAreCopies(ring, candidate)) return other;
      }
    }
  }
  return null;
}

function ringsAreCopies(a: LeadRing, b: LeadRing): boolean {
  return (
    Math.abs(a.bounds.minX - b.bounds.minX) <= COPY_MM &&
    Math.abs(a.bounds.minY - b.bounds.minY) <= COPY_MM &&
    Math.abs(a.bounds.maxX - b.bounds.maxX) <= COPY_MM &&
    Math.abs(a.bounds.maxY - b.bounds.maxY) <= COPY_MM &&
    Math.abs(a.lengthMm - b.lengthMm) <= COPY_MM + a.lengthMm * COPY_LENGTH_RELATIVE
  );
}

function copyLists(representatives: ReadonlyArray<number>): number[][] {
  const members = new Map<number, number[]>();
  representatives.forEach((representative, index) => {
    const list = members.get(representative);
    if (list === undefined) members.set(representative, [index]);
    else list.push(index);
  });
  return representatives.map((representative, index) =>
    (members.get(representative) ?? []).filter((other) => other !== index),
  );
}

function ring(
  points: ReadonlyArray<Vec2>,
  lineIds: ReadonlyArray<number>,
  nesting: CutSegment['nesting'],
): LeadRing {
  const bounds = polylineBounds(points) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    points,
    bounds,
    lengthMm: outlineLength(points),
    lineIds,
    ...(nesting === undefined ? {} : { nesting: { forest: nesting.forest, depth: nesting.depth } }),
  };
}

// Greedy: from the first piece, always continue with the unused piece whose
// nearer end is closest to where the outline has got to, reversed when its far
// end is the nearer one. The pieces of one contour meet across tab or dash
// gaps, so this recovers their order whatever order the planner left them in.
function chainPieces(pieces: ReadonlyArray<ReadonlyArray<Vec2>>): ReadonlyArray<Vec2> {
  const used = new Array<boolean>(pieces.length).fill(false);
  const outline: Vec2[] = [...(pieces[0] ?? [])];
  used[0] = true;
  for (let step = 1; step < pieces.length; step += 1) {
    const tail = outline[outline.length - 1];
    if (tail === undefined) break;
    let best = -1;
    let bestReversed = false;
    let bestSq = Number.POSITIVE_INFINITY;
    pieces.forEach((piece, index) => {
      if (used[index] === true) return;
      const startSq = distanceSq(tail, piece[0]);
      const endSq = distanceSq(tail, piece[piece.length - 1]);
      if (Math.min(startSq, endSq) < bestSq) {
        best = index;
        bestReversed = endSq < startSq;
        bestSq = Math.min(startSq, endSq);
      }
    });
    if (best < 0) break;
    used[best] = true;
    const piece = pieces[best] ?? [];
    outline.push(...(bestReversed ? [...piece].reverse() : piece));
  }
  return outline;
}

function distanceSq(a: Vec2, b: Vec2 | undefined): number {
  if (b === undefined) return Number.POSITIVE_INFINITY;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function outlineLength(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Vec2;
    const b = points[index] as Vec2;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}
