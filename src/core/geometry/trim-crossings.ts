// Where a contour meets other outlines, for Trim Shapes (LightBurn gap
// LBG-T04). Crossings are found on world chords: the contour's chords sit in a
// uniform grid, and every chord of every other outline whose bounds reach the
// contour is tested only against the cells it overlaps. A touch counts as a
// crossing, so a line ending on a shape splits that shape there. The contour
// also crosses itself where its non-adjacent chords meet.

import type { Bounds, Vec2 } from '../scene';
import { boundsOverlap, type TrimContour } from './trim-contours';

export type TrimCrossing = {
  /** Position on the contour (segment + t). */
  readonly p: number;
  /** The contour chord it lies on. */
  readonly chord: number;
  readonly point: Vec2;
  /** The chord of the other outline, so the exact curve can be refined onto it. */
  readonly edgeStart: Vec2;
  readonly edgeEnd: Vec2;
};

// A touch within this distance counts; float noise, not a user tolerance.
const TOUCH_MM = 1e-6;
// Crossings this close along the contour are one crossing.
const MERGE_MM = 1e-6;
// An open contour's own end is not a crossing; closer than this is its end.
const END_MM = 1e-3;
const MAX_GRID_CELLS_PER_AXIS = 256;

type ChordGrid = {
  readonly bounds: Bounds;
  readonly cols: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly cells: ReadonlyArray<ReadonlyArray<number>>;
};

/** The contour's crossings with the given outlines (itself included), sorted along it. */
export function contourCrossings(
  contour: TrimContour,
  outlines: ReadonlyArray<TrimContour>,
): ReadonlyArray<TrimCrossing> {
  const grid = buildChordGrid(contour);
  const found: TrimCrossing[] = [];
  for (const outline of outlines) {
    if (!boundsOverlap(outline.bounds, contour.bounds, TOUCH_MM)) continue;
    if (outline.key === contour.key) collectSelfCrossings(contour, grid, found);
    else collectCrossings(contour, grid, outline, found);
  }
  return tidyCrossings(contour, found);
}

function collectCrossings(
  contour: TrimContour,
  grid: ChordGrid,
  outline: TrimContour,
  found: TrimCrossing[],
): void {
  const seen = new Int32Array(contour.points.length);
  for (let edge = 0; edge < outline.points.length - 1; edge += 1) {
    const a = outline.points[edge] as Vec2;
    const b = outline.points[edge + 1] as Vec2;
    forEachChordNear(grid, segmentBounds(a, b), seen, edge + 1, (chord) => {
      const crossing = crossingOn(contour, chord, a, b);
      if (crossing !== null) found.push(crossing);
    });
  }
}

function collectSelfCrossings(contour: TrimContour, grid: ChordGrid, found: TrimCrossing[]): void {
  const last = contour.points.length - 2;
  const seen = new Int32Array(contour.points.length);
  for (let edge = 0; edge <= last; edge += 1) {
    const a = contour.points[edge] as Vec2;
    const b = contour.points[edge + 1] as Vec2;
    forEachChordNear(grid, segmentBounds(a, b), seen, edge + 1, (chord) => {
      if (chord <= edge + 1 || (contour.closed && edge === 0 && chord === last)) return;
      const onChord = crossingOn(contour, chord, a, b);
      if (onChord === null) return;
      const p = contour.points[chord] as Vec2;
      const q = contour.points[chord + 1] as Vec2;
      const onEdge = crossingOn(contour, edge, p, q);
      found.push(onChord);
      if (onEdge !== null) found.push(onEdge);
    });
  }
}

/** The crossing of contour chord `chord` with segment a-b, if they meet. */
function crossingOn(contour: TrimContour, chord: number, a: Vec2, b: Vec2): TrimCrossing | null {
  const p = contour.points[chord] as Vec2;
  const q = contour.points[chord + 1] as Vec2;
  const hit = segmentHit(p, q, a, b);
  if (hit === null) return null;
  const p0 = contour.params[chord] as number;
  const p1 = contour.params[chord + 1] as number;
  return {
    p: p0 + (p1 - p0) * hit,
    chord,
    point: { x: p.x + (q.x - p.x) * hit, y: p.y + (q.y - p.y) * hit },
    edgeStart: a,
    edgeEnd: b,
  };
}

/** Fraction along p-q where it meets a-b, or null when they miss or run parallel. */
export function segmentHit(p: Vec2, q: Vec2, a: Vec2, b: Vec2): number | null {
  const rx = q.x - p.x;
  const ry = q.y - p.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const lengthR = Math.hypot(rx, ry);
  const lengthS = Math.hypot(sx, sy);
  if (lengthR <= TOUCH_MM || lengthS <= TOUCH_MM) return null;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) <= 1e-12 * lengthR * lengthS) return null;
  const wx = a.x - p.x;
  const wy = a.y - p.y;
  const u = (wx * sy - wy * sx) / denominator;
  const v = (wx * ry - wy * rx) / denominator;
  const slackU = TOUCH_MM / lengthR;
  const slackV = TOUCH_MM / lengthS;
  if (u < -slackU || u > 1 + slackU || v < -slackV || v > 1 + slackV) return null;
  return Math.min(1, Math.max(0, u));
}

function tidyCrossings(
  contour: TrimContour,
  found: ReadonlyArray<TrimCrossing>,
): ReadonlyArray<TrimCrossing> {
  const sorted = [...found].sort((left, right) => left.p - right.p);
  const merged: TrimCrossing[] = [];
  for (const crossing of sorted) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && sameCrossing(contour, previous, crossing)) continue;
    merged.push(crossing);
  }
  const first = merged[0];
  const last = merged[merged.length - 1];
  if (contour.closed && merged.length > 1 && first !== undefined && last !== undefined) {
    if (sameCrossing(contour, first, last)) merged.pop();
  }
  return contour.closed ? merged : merged.filter((crossing) => !atOpenEnd(contour, crossing));
}

// Two finds are one crossing when they sit at one point on the same or
// neighbouring chords: a crossing at a vertex is found on both of its chords.
function sameCrossing(contour: TrimContour, a: TrimCrossing, b: TrimCrossing): boolean {
  const chords = contour.points.length - 1;
  const apart = Math.abs(a.chord - b.chord);
  const neighbours = apart <= 1 || (contour.closed && apart === chords - 1);
  return neighbours && Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y) <= MERGE_MM;
}

function atOpenEnd(contour: TrimContour, crossing: TrimCrossing): boolean {
  const start = contour.points[0] as Vec2;
  const end = contour.points[contour.points.length - 1] as Vec2;
  const near = (point: Vec2): boolean =>
    Math.hypot(point.x - crossing.point.x, point.y - crossing.point.y) <= END_MM;
  return (
    (crossing.chord === 0 && near(start)) ||
    (crossing.chord === contour.points.length - 2 && near(end))
  );
}

function buildChordGrid(contour: TrimContour): ChordGrid {
  const chords = contour.points.length - 1;
  const perAxis = Math.max(1, Math.min(MAX_GRID_CELLS_PER_AXIS, Math.ceil(Math.sqrt(chords))));
  const bounds = contour.bounds;
  const cellWidth = Math.max((bounds.maxX - bounds.minX) / perAxis, TOUCH_MM);
  const cellHeight = Math.max((bounds.maxY - bounds.minY) / perAxis, TOUCH_MM);
  const cells: number[][] = Array.from({ length: perAxis * perAxis }, () => []);
  const grid = { bounds, cols: perAxis, rows: perAxis, cellWidth, cellHeight, cells };
  for (let chord = 0; chord < chords; chord += 1) {
    const box = segmentBounds(contour.points[chord] as Vec2, contour.points[chord + 1] as Vec2);
    forEachCell(grid, box, (cell) => cells[cell]?.push(chord));
  }
  return grid;
}

function forEachChordNear(
  grid: ChordGrid,
  box: Bounds,
  seen: Int32Array,
  stamp: number,
  visit: (chord: number) => void,
): void {
  if (!boundsOverlap(box, grid.bounds, TOUCH_MM)) return;
  forEachCell(grid, box, (cell) => {
    for (const chord of grid.cells[cell] ?? []) {
      if (seen[chord] === stamp) continue;
      seen[chord] = stamp;
      visit(chord);
    }
  });
}

function forEachCell(grid: ChordGrid, box: Bounds, visit: (cell: number) => void): void {
  const col0 = cellIndex(box.minX - TOUCH_MM, grid.bounds.minX, grid.cellWidth, grid.cols);
  const col1 = cellIndex(box.maxX + TOUCH_MM, grid.bounds.minX, grid.cellWidth, grid.cols);
  const row0 = cellIndex(box.minY - TOUCH_MM, grid.bounds.minY, grid.cellHeight, grid.rows);
  const row1 = cellIndex(box.maxY + TOUCH_MM, grid.bounds.minY, grid.cellHeight, grid.rows);
  for (let row = row0; row <= row1; row += 1) {
    for (let col = col0; col <= col1; col += 1) visit(row * grid.cols + col);
  }
}

function cellIndex(value: number, min: number, size: number, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.floor((value - min) / size)));
}

function segmentBounds(a: Vec2, b: Vec2): Bounds {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}
