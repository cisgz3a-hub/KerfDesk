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
// inside.

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
  /** Containment depth of each ring. */
  readonly depths: ReadonlyArray<number>;
};

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
  const depths = containmentDepths(
    rings.map((entry) => ({
      polyline: entry.points,
      closed: true,
      ...(entry.nesting === undefined ? {} : { nesting: entry.nesting }),
    })),
    { strict: true },
  );
  return { lines, lineOf, rings, ringOfLine, depths };
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
