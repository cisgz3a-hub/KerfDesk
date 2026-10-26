// Contours that open cut lines close a region round (ADR-626 Amendment 8;
// rolling audit 2026-10-21, 03-P1-2).
//
// The scrap side is judged by parity among closed contours, and an open path
// has no inside. A plate CAD draws as four LINEs, a sketch whose lines cross
// at the corners, or lines that stop a hair short of each other are all open
// paths, so no closed shape held the hole inside such a plate: it was read as
// an outer contour and both its leads burned into the plate. Open lines may be
// the edge of a part or only score lines, so which side of them is scrap is
// unknown. A contour in a region open lines close therefore gets no side, as
// one inside a closed shape without leads does (Amendment 1 D3).
//
// The open lines of every burning Line operation are drawn as strokes
// OPEN_OUTLINE_GAP_MM wide, round at their ends, and united: a hole of the
// union is a region the lines close, whether their ends meet, cross or stop
// within that gap of each other. A contour with a point in such a region is
// held by those lines, however many closed shapes sit between. Closed
// contours do not take part: open lines that close a region only together
// with a closed shape's edge are not read here.
//
// A gap wider than that still leaves an outline (Amendment 10,
// laser-lead-open-gaps.ts): lines that run nearly all the way round, their
// free ends closer together than a tenth of their length, hold a contour with
// a point inside the region they would close, clear of the lines themselves.

import {
  areaD,
  EndType,
  inflatePathsD,
  isPositiveD,
  JoinType,
  simplifyPathsD,
  type PathD,
} from 'clipper2-ts';
import { pointInPolygon } from '../geometry/point-in-polygon';
import { PolygonEdgeIndex } from '../geometry/polygon-edge-index';
import { tryVectorOp } from '../geometry/vector-path-tools';
import { polylineToCurveSubpath, type Vec2 } from '../scene';
import { ContourBoxIndex } from '../trace/contour-box-index';
import { openOutlines, type OpenOutline } from './laser-lead-open-gaps';
import { CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM } from './open-fill-contours';

/** Open lines whose ends come this close close a region: the gap Fill
 * already offers to close for an open contour. */
export const OPEN_OUTLINE_GAP_MM = CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM;
const STROKE_RADIUS_MM = OPEN_OUTLINE_GAP_MM / 2;
// Simplification keeps every end and stays this close to the lines between.
const SIMPLIFY_MM = 0.05;
// Round caps are sampled this close to the circle, so ends up to 0.48 mm apart
// always close.
const CAP_TOLERANCE_MM = 0.01;
const PRECISION_DECIMALS = 3;
const MITER_LIMIT = 2;

/** An open path of a burning Line operation, in scene coordinates. */
export type SceneOpenLine = {
  readonly points: ReadonlyArray<Vec2>;
  readonly operationName: string;
};

type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type Ring = {
  readonly points: ReadonlyArray<Vec2>;
  readonly box: Box;
  readonly hole: boolean;
  readonly area: number;
};

/** For each contour, the operation whose open lines close a region round it,
 * or nearly all the way round it, or undefined when no open lines do. */
export function openLineHolders(
  contours: ReadonlyArray<ReadonlyArray<Vec2>>,
  lines: ReadonlyArray<SceneOpenLine>,
): ReadonlyArray<string | undefined> {
  const drawn = lines.filter((line) => line.points.length >= 2);
  const closing = closingLineHolders(contours, drawn);
  if (closing.every((holder) => holder !== undefined)) return closing;
  const leftOpen = leftOpenHolders(contours, drawn);
  return closing.map((holder, index) => holder ?? leftOpen(index));
}

function closingLineHolders(
  contours: ReadonlyArray<ReadonlyArray<Vec2>>,
  lines: ReadonlyArray<SceneOpenLine>,
): ReadonlyArray<string | undefined> {
  const boxes = contours.map(boxOf);
  const strokes = reachingStrokes(lines, boxes);
  const first = strokes[0];
  if (first === undefined) return contours.map(() => undefined);
  const rings = unitedStrokes(strokes);
  // The offset engine failed: any contour the lines reach may be held.
  if (rings === null) {
    const reach = grown(boxOf(strokes.flatMap((line) => line.points)), STROKE_RADIUS_MM);
    return boxes.map((box) => (overlaps(box, reach) ? first.operationName : undefined));
  }
  const holes = rings.filter((ring) => ring.hole);
  if (holes.length === 0) return contours.map(() => undefined);
  return contours.map((points, index) => {
    const box = boxes[index] as Box;
    if (!holes.some((hole) => overlaps(hole.box, box))) return undefined;
    for (const point of points) {
      const hole = enclosingHole(point, rings);
      if (hole !== null) return nearestOperation(hole, strokes);
    }
    return undefined;
  });
}

// Amendment 10: lines that run nearly all the way round a contour, their ends
// further apart than the strokes close. The lines of every burning Line
// operation chain, as their strokes unite above, and the region an outline
// would close holds a contour with a point inside it that is clear of the
// outline's own lines: a contour drawn on the lines is not inside them.
function leftOpenHolders(
  contours: ReadonlyArray<ReadonlyArray<Vec2>>,
  lines: ReadonlyArray<SceneOpenLine>,
): (contour: number) => string | undefined {
  const outlines = openOutlines(
    lines.map((line) => ({
      curve: polylineToCurveSubpath({ points: line.points, closed: false }),
      signature: '',
    })),
    OPEN_OUTLINE_GAP_MM,
  ).flatMap((outline) => {
    const box = boxOf(outline.points);
    return [box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite)
      ? [{ ...box, outline, edges: lazyEdges(outline.points) }]
      : [];
  });
  if (outlines.length === 0) return () => undefined;
  const index = ContourBoxIndex.create(outlines);
  return (contour) => {
    const points = contours[contour] ?? [];
    const held = index.query(boxOf(points)).find((region) => regionHolds(region, points));
    return held === undefined ? undefined : lines[held.outline.index]?.operationName;
  };
}

type OutlineRegion = Box & {
  readonly outline: OpenOutline;
  readonly edges: () => PolygonEdgeIndex | null;
};

// Outlines with more points than this are tested through an index of their
// edges, built on first use.
const INDEXED_OUTLINE_POINTS = 32;

function lazyEdges(points: ReadonlyArray<Vec2>): () => PolygonEdgeIndex | null {
  let built: PolygonEdgeIndex | null | undefined;
  return () => {
    if (built === undefined)
      built = points.length > INDEXED_OUTLINE_POINTS ? PolygonEdgeIndex.create(points) : null;
    return built;
  };
}

function regionHolds(region: OutlineRegion, points: ReadonlyArray<Vec2>): boolean {
  const { outline } = region;
  for (const point of points) {
    if (!contains(region, point)) continue;
    const edges = region.edges();
    const inside =
      edges === null ? pointInPolygon(point, outline.points) : edges.containsPoint(point);
    if (inside && clearOfLines(point, outline.points, STROKE_RADIUS_MM)) return true;
  }
  return false;
}

/** Farther than `marginMm` from the open lines, the closing gap aside. */
function clearOfLines(point: Vec2, points: ReadonlyArray<Vec2>, marginMm: number): boolean {
  for (let index = 1; index < points.length; index += 1) {
    if (segmentDistance(point, points[index - 1] as Vec2, points[index] as Vec2) <= marginMm)
      return false;
  }
  return true;
}

// Lines whose strokes cannot meet cannot close a region together, and a
// region some lines close lies within their bounds. So the lines fall into
// clusters whose bounds, grown by the stroke radius, overlap (or merely share
// a grid cell: joining more than needed costs time, never a region), and
// only the clusters whose bounds meet a contour are united: line art far
// from every contour costs nothing.
function reachingStrokes(
  strokes: ReadonlyArray<SceneOpenLine>,
  contours: ReadonlyArray<Box>,
): SceneOpenLine[] {
  if (strokes.length === 0 || contours.length === 0) return [];
  const reach = strokes.map((line) => grown(boxOf(line.points), STROKE_RADIUS_MM));
  const cluster = clustersByCell(reach);
  const extent = new Map<number, Box>();
  reach.forEach((box, index) => {
    const root = cluster(index);
    const known = extent.get(root);
    extent.set(root, known === undefined ? box : merged(known, box));
  });
  const kept = new Set<number>();
  for (const [root, box] of extent) {
    if (contours.some((contour) => overlaps(contour, box))) kept.add(root);
  }
  return strokes.filter((_, index) => kept.has(cluster(index)));
}

/** Union-find over boxes that share a grid cell. Boxes that overlap always
 * share one, so no overlapping pair is ever apart, and the work grows with the
 * cells the boxes cover, never with pairs of boxes. */
function clustersByCell(boxes: ReadonlyArray<Box>): (index: number) => number {
  const parent = boxes.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root] as number;
    while (parent[index] !== root) {
      const next = parent[index] as number;
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const size = cellSize(boxes);
  const first = new Map<string, number>();
  boxes.forEach((box, index) => {
    for (let x = Math.floor(box.minX / size); x <= Math.floor(box.maxX / size); x += 1) {
      for (let y = Math.floor(box.minY / size); y <= Math.floor(box.maxY / size); y += 1) {
        const key = `${x},${y}`;
        const other = first.get(key);
        if (other === undefined) first.set(key, index);
        else parent[find(other)] = find(index);
      }
    }
  });
  return find;
}

// The finest cell, doubling from MIN_CELL_MM, at which the boxes cover at most
// CELLS_PER_BOX cells each on average: long lines get coarse cells rather than
// thousands each.
const MIN_CELL_MM = 1;
const CELLS_PER_BOX = 8;

function cellSize(boxes: ReadonlyArray<Box>): number {
  let size = MIN_CELL_MM;
  while (coveredCells(boxes, size) > CELLS_PER_BOX * boxes.length) size *= 2;
  return size;
}

function coveredCells(boxes: ReadonlyArray<Box>, size: number): number {
  let cells = 0;
  for (const box of boxes) {
    const columns = Math.floor(box.maxX / size) - Math.floor(box.minX / size) + 1;
    const rows = Math.floor(box.maxY / size) - Math.floor(box.minY / size) + 1;
    cells += columns * rows;
  }
  return cells;
}

function unitedStrokes(strokes: ReadonlyArray<SceneOpenLine>): Ring[] | null {
  const paths: PathD[] = strokes.map((line) => line.points.map((point) => ({ ...point })));
  // Lines flattened from curves are dense; within SIMPLIFY_MM of them the
  // strokes, and the gap they close, are the same, at a fraction of the cost.
  const united = tryVectorOp(() =>
    inflatePathsD(
      simplifyPathsD(paths, SIMPLIFY_MM, false),
      STROKE_RADIUS_MM,
      JoinType.Round,
      EndType.Round,
      MITER_LIMIT,
      PRECISION_DECIMALS,
      CAP_TOLERANCE_MM,
    ),
  );
  if (united.kind === 'error') return null;
  return united.value.map((path) => ({
    points: path.map(({ x, y }) => ({ x, y })),
    box: boxOf(path),
    hole: !isPositiveD(path),
    area: Math.abs(areaD(path)),
  }));
}

// The innermost ring round the point decides: inside a hole, and on no
// island within it, the point lies in a region the lines close.
function enclosingHole(point: Vec2, rings: ReadonlyArray<Ring>): Ring | null {
  let innermost: Ring | null = null;
  for (const ring of rings) {
    if (!contains(ring.box, point) || !pointInPolygon(point, ring.points)) continue;
    if (innermost === null || ring.area < innermost.area) innermost = ring;
  }
  return innermost?.hole === true ? innermost : null;
}

// Every point of a hole's ring lies half the gap from an open line; the one
// nearest its first point names the operation.
function nearestOperation(hole: Ring, strokes: ReadonlyArray<SceneOpenLine>): string {
  const at = hole.points[0] as Vec2;
  let best = strokes[0] as SceneOpenLine;
  let distance = Number.POSITIVE_INFINITY;
  for (const line of strokes) {
    for (let index = 1; index < line.points.length; index += 1) {
      const gap = segmentDistance(at, line.points[index - 1] as Vec2, line.points[index] as Vec2);
      if (gap < distance) {
        distance = gap;
        best = line;
      }
    }
  }
  return best.operationName;
}

function segmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function boxOf(points: ReadonlyArray<Vec2>): Box {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { x, y } of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function contains(box: Box, point: Vec2): boolean {
  return point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;
}

function overlaps(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

function grown(box: Box, by: number): Box {
  return { minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by };
}

function merged(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
