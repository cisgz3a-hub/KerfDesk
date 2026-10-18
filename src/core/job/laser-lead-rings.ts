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

import { sampleArcMoves } from '../geometry/arc-fit';
import type { Vec2 } from '../scene';
import { emittedCutArcMoves } from './cut-arc-moves';
import { containmentDepths } from './containment-depth';
import type { CutSegment, Job } from './job';
import { chainPieces } from './laser-lead-chain';
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
      lines.push(burnLine(segment, group.entryRunwayMm));
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
    const outline = chainPieces(ids.map((id) => lines[id] ?? []));
    if (outline.length < 3) continue;
    // The whole outline, its uncut gaps bridged, is a line a lead keeps clear
    // of too: a lead slipping through two tab gaps would burn across the part.
    const bridged = lines.length;
    lines.push([...outline, outline[0] as Vec2]);
    rings.push(ring(outline, [...ids, bridged], nesting));
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

// Same bounds and length first, cheaply; then the outlines themselves, so two
// different shapes that happen to share both (mirrored L shapes) stay apart.
function ringsAreCopies(a: LeadRing, b: LeadRing): boolean {
  return (
    Math.abs(a.bounds.minX - b.bounds.minX) <= COPY_MM &&
    Math.abs(a.bounds.minY - b.bounds.minY) <= COPY_MM &&
    Math.abs(a.bounds.maxX - b.bounds.maxX) <= COPY_MM &&
    Math.abs(a.bounds.maxY - b.bounds.maxY) <= COPY_MM &&
    Math.abs(a.lengthMm - b.lengthMm) <= COPY_MM + a.lengthMm * COPY_LENGTH_RELATIVE &&
    outlineRidesOn(a.points, b.points) &&
    outlineRidesOn(b.points, a.points)
  );
}

// Probes spread along an outline; each must lie on the other within COPY_MM.
const COPY_PROBES = 32;

function outlineRidesOn(probe: ReadonlyArray<Vec2>, outline: ReadonlyArray<Vec2>): boolean {
  const stride = Math.max(1, Math.floor(probe.length / COPY_PROBES));
  for (let index = 0; index < probe.length; index += stride) {
    const point = probe[index] as Vec2;
    if (distanceToOutline(point, outline) > COPY_MM) return false;
  }
  return true;
}

function distanceToOutline(point: Vec2, outline: ReadonlyArray<Vec2>): number {
  let bestSq = Number.POSITIVE_INFINITY;
  for (let index = 0; index < outline.length; index += 1) {
    const a = outline[index] as Vec2;
    const b = outline[(index + 1) % outline.length] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
    const ox = point.x - (a.x + t * dx);
    const oy = point.y - (a.y + t * dy);
    bestSq = Math.min(bestSq, ox * ox + oy * oy);
  }
  return Math.sqrt(bestSq);
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

// The line as it burns: on an arc machine a contour that goes out as G2/G3
// bows past its chords, so its moves are sampled finely enough that a lead's
// clearance from it is measured from the arc itself (ADR-432 decides by the
// same predicate). Otherwise the chords are the burn.
const OBSTACLE_ARC_SAGITTA_MM = 0.002;

function burnLine(segment: CutSegment, entryRunwayMm: number | undefined): ReadonlyArray<Vec2> {
  const moves = emittedCutArcMoves(segment, { arcMovesEnabled: true, entryRunwayMm });
  const first = segment.polyline[0];
  if (moves === null || first === undefined) return segment.polyline;
  return sampleArcMoves(first, moves, OBSTACLE_ARC_SAGITTA_MM);
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

function outlineLength(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Vec2;
    const b = points[index] as Vec2;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}
