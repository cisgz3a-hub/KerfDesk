// Remove overlapping lines with a merge tolerance (LightBurn gap LBG-C13): the
// opt-in output cleanup of remove-cut-overlaps.ts, where a Line span also
// counts as already cut when an earlier contour of the same operation runs
// alongside it, the same way or the opposite way to within MERGE_ANGLE_DEG,
// no farther away than the tolerance. Only a merge tolerance above zero comes
// here; zero keeps the exact rule, so default output does not change.
//
// Contours are taken in cut order. Each edge loses the stretches that lie
// within the tolerance of what the contours before it still cut, and what it
// keeps is what later contours are measured against, so a merge never chains
// along a row of near lines to something farther away than the tolerance. A
// contour is never measured against itself: retracing within one contour is
// deliberate motion, as in the exact rule. Lines that meet at a steeper angle
// are never merged, nor are lines that cross from one side of the tolerance
// band to the other, so a T-junction or a crossing keeps its full cut.
// Geometry is compared at emitted precision, so exact overlaps merge here too.
// Kerf and tabs already exist in these polylines; passes and settings are
// untouched, and nothing is ever joined or extended.

import { formatGcodeCoordinateMm } from '../gcode/coordinate-format';
import type { Vec2 } from '../scene';
import { withoutArcMoves } from './cut-arc-moves';
import type { CutGroup, CutSegment } from './job';

/** Spans turning more than this apart are crossings or corners, never overlaps. */
export const MERGE_ANGLE_DEG = 5;
const SIN_MERGE_ANGLE = Math.sin((MERGE_ANGLE_DEG * Math.PI) / 180);
// Pieces shorter than one emitted coordinate step are left out after a split.
const MIN_PIECE_MM = 0.001;
const MIN_CELL_MM = 0.5;

type Line = {
  readonly ax: number;
  readonly ay: number;
  /** Unit direction and length. */
  readonly ux: number;
  readonly uy: number;
  readonly length: number;
};

type Piece = readonly [Vec2, Vec2];

export function removeNearCutOverlaps(group: CutGroup, toleranceMm: number): CutGroup {
  if (group.segments.length < 2 || group.segments.some(isCncProjection)) return group;
  const index = new SpanIndex(Math.max(MIN_CELL_MM, 4 * toleranceMm));
  let changed = false;
  const segments = group.segments.flatMap((segment) => {
    const kept = keptPieces(segment, index, toleranceMm);
    for (const [start, end] of kept.pieces) {
      const line = represented(start, end);
      if (line !== null) index.add(line);
    }
    if (!kept.changed) return [segment];
    changed = true;
    return joined(kept.pieces).map((polyline) => ({
      ...withoutArcMoves(segment),
      polyline,
      closed: false,
    }));
  });
  return changed ? { ...group, segments } : group;
}

function isCncProjection(segment: CutSegment): boolean {
  return segment.plannerCoordinatesRepresented === true || segment.plannerMotion !== undefined;
}

function keptPieces(
  segment: CutSegment,
  index: SpanIndex,
  toleranceMm: number,
): { readonly pieces: Piece[]; readonly changed: boolean } {
  const pieces: Piece[] = [];
  let changed = false;
  for (let k = 1; k < segment.polyline.length; k += 1) {
    const start = segment.polyline[k - 1] as Vec2;
    const end = segment.polyline[k] as Vec2;
    const line = represented(start, end);
    if (line === null) {
      pieces.push([start, end]);
      continue;
    }
    const covered = coveredIntervals(line, index, toleranceMm);
    if (covered.length === 0) {
      pieces.push([start, end]);
      continue;
    }
    changed = true;
    for (const [from, to] of uncovered(covered, line.length)) {
      pieces.push([
        from === 0 ? start : pointAt(line, from),
        to === line.length ? end : pointAt(line, to),
      ]);
    }
  }
  return { pieces, changed };
}

// The edge as the machine will cut it: coordinates at emitted precision.
function represented(start: Vec2, end: Vec2): Line | null {
  const ax = emitted(start.x);
  const ay = emitted(start.y);
  const dx = emitted(end.x) - ax;
  const dy = emitted(end.y) - ay;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!(length > 0) || !Number.isFinite(length)) return null;
  return { ax, ay, ux: dx / length, uy: dy / length, length };
}

function emitted(value: number): number {
  return Number(formatGcodeCoordinateMm(value));
}

function pointAt(line: Line, at: number): Vec2 {
  return { x: emitted(line.ax + line.ux * at), y: emitted(line.ay + line.uy * at) };
}

// Stretches of `edge` (as distances from its start) lying within the
// tolerance of a near-parallel span already kept, merged and sorted.
function coveredIntervals(
  edge: Line,
  index: SpanIndex,
  toleranceMm: number,
): Array<[number, number]> {
  const intervals: Array<[number, number]> = [];
  for (const span of index.near(edge)) {
    const interval = coveredBy(edge, span, toleranceMm);
    if (interval !== null) intervals.push(interval);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last !== undefined && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else merged.push([interval[0], interval[1]]);
  }
  return merged;
}

// Where along `edge` its points lie beside `span` (their foot on the span
// falls within it) and no farther than the tolerance from it. Both conditions
// are linear in the distance t along the edge. Null when the two turn apart by
// more than MERGE_ANGLE_DEG or cross each other.
function coveredBy(edge: Line, span: Line, toleranceMm: number): [number, number] | null {
  const cross = edge.ux * span.uy - edge.uy * span.ux;
  if (Math.abs(cross) > SIN_MERGE_ANGLE) return null;
  const dot = edge.ux * span.ux + edge.uy * span.uy;
  const rx = edge.ax - span.ax;
  const ry = edge.ay - span.ay;
  // Foot of E(t) on the span's line: along0 + t * dot, within [0, span.length].
  const along0 = rx * span.ux + ry * span.uy;
  // Signed distance of E(t) from the span's line: side0 + t * cross.
  const side0 = rx * span.uy - ry * span.ux;
  let low = 0;
  let high = edge.length;
  [low, high] = clampLinear(low, high, along0, dot, 0, span.length);
  [low, high] = clampLinear(low, high, side0, cross, -toleranceMm, toleranceMm);
  if (!(high - low > 0)) return null;
  // Running across the band from one side to the other is a crossing, even a
  // shallow one: along a merged stretch the gap may change by the tolerance at
  // most, which still lets a copy turned by a hair merge over its whole length.
  return Math.abs(cross) * (high - low) <= toleranceMm ? [low, high] : null;
}

// The part of [low, high] where min <= base + t * slope <= max.
function clampLinear(
  low: number,
  high: number,
  base: number,
  slope: number,
  min: number,
  max: number,
): [number, number] {
  if (Math.abs(slope) < 1e-12) return base >= min && base <= max ? [low, high] : [0, 0];
  const t1 = (min - base) / slope;
  const t2 = (max - base) / slope;
  return [Math.max(low, Math.min(t1, t2)), Math.min(high, Math.max(t1, t2))];
}

function uncovered(
  covered: ReadonlyArray<readonly [number, number]>,
  length: number,
): Array<[number, number]> {
  const kept: Array<[number, number]> = [];
  let at = 0;
  for (const [from, to] of covered) {
    if (from - at >= MIN_PIECE_MM) kept.push([at, from]);
    at = Math.max(at, to);
  }
  if (length - at >= MIN_PIECE_MM) kept.push([at, length]);
  return kept;
}

// Consecutive pieces that meet at one emitted point become one polyline.
function joined(pieces: ReadonlyArray<Piece>): Vec2[][] {
  const polylines: Vec2[][] = [];
  for (const [start, end] of pieces) {
    const last = polylines[polylines.length - 1];
    if (last !== undefined && sameEmittedPoint(last[last.length - 1] as Vec2, start)) {
      last.push(end);
    } else {
      polylines.push([start, end]);
    }
  }
  return polylines;
}

function sameEmittedPoint(a: Vec2, b: Vec2): boolean {
  return (
    formatGcodeCoordinateMm(a.x) === formatGcodeCoordinateMm(b.x) &&
    formatGcodeCoordinateMm(a.y) === formatGcodeCoordinateMm(b.y)
  );
}

// Kept spans filed by grid cell. A line is sampled every half cell, so each of
// its points is within a quarter cell of a sample; with the tolerance at most a
// quarter cell, a span within the tolerance of an edge has a sample less than
// one cell from one of the edge's, so it is filed in a cell next to one of them.
class SpanIndex {
  private readonly cells = new Map<string, Line[]>();

  constructor(private readonly cell: number) {}

  add(line: Line): void {
    for (const key of this.keys(line, 0)) {
      const list = this.cells.get(key);
      if (list === undefined) this.cells.set(key, [line]);
      else list.push(line);
    }
  }

  /** Every kept span that could lie within the tolerance of the line (and some others). */
  near(line: Line): Set<Line> {
    const found = new Set<Line>();
    for (const key of this.keys(line, 1)) {
      for (const span of this.cells.get(key) ?? []) found.add(span);
    }
    return found;
  }

  private keys(line: Line, ring: number): Set<string> {
    const keys = new Set<string>();
    const pieces = Math.max(1, Math.ceil((2 * line.length) / this.cell));
    for (let piece = 0; piece <= pieces; piece += 1) {
      const at = (line.length * piece) / pieces;
      const cx = Math.floor((line.ax + line.ux * at) / this.cell);
      const cy = Math.floor((line.ay + line.uy * at) / this.cell);
      for (let y = cy - ring; y <= cy + ring; y += 1) {
        for (let x = cx - ring; x <= cx + ring; x += 1) keys.add(`${x},${y}`);
      }
    }
    return keys;
  }
}
