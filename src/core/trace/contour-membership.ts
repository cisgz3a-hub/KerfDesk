import type { Vec2 } from '../scene';
import { contourBox, finiteContourBox, type ContourBox } from './contour-bounds';
import { ContourOrientation, insideContour } from './contour-orientation';
import { runTraceSteps, type TraceSteps } from './trace-steps';

type MembershipResult = { readonly x: number; readonly y: number; readonly inside: boolean };
type PreparedContour = {
  readonly bounds: ContourBox;
  readonly membership: WeakMap<Vec2, MembershipResult>;
  rows?: CrossingRows;
};

/** Reuse immutable source/candidate boundaries during one topology repair. */
export class ContourMembership {
  private readonly prepared = new WeakMap<ReadonlyArray<Vec2>, PreparedContour | null>();
  private readonly orientation = new ContourOrientation();

  contains(point: Vec2, points: ReadonlyArray<Vec2>): boolean {
    return runTraceSteps(this.containsSteps(point, points));
  }

  *containsSteps(point: Vec2, points: ReadonlyArray<Vec2>): TraceSteps<boolean> {
    yield;
    let contour = this.prepared.get(points);
    if (contour === undefined) {
      const bounds = contourBox(points);
      contour = finiteContourBox(bounds) ? { bounds, membership: new WeakMap() } : null;
      this.prepared.set(points, contour);
    }
    if (contour === null || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return insideContour(point, points);
    }
    const { bounds } = contour;
    if (
      point.x < bounds.minX ||
      point.x > bounds.maxX ||
      point.y < bounds.minY ||
      point.y > bounds.maxY
    )
      return false;
    // Refinement revisits the same source/candidate relationships. Cache only
    // queries that need a ray scan; cheap bounding rejects need no retained entry.
    const previous = contour.membership.get(point);
    if (matchesQuery(previous, point)) return previous.inside;
    contour.rows ??= yield* crossingRowsSteps(points, contour.bounds);
    const inside = rayWinding(point, contour.rows, this.orientation) !== 0;
    contour.membership.set(point, { x: point.x, y: point.y, inside });
    return inside;
  }
}

function matchesQuery(
  previous: MembershipResult | undefined,
  point: Vec2,
): previous is MembershipResult {
  return previous !== undefined && previous.x === point.x && previous.y === point.y;
}

// Non-horizontal edges bucketed by horizontal band. A rightward ray at y can
// only meet edges whose y-range holds y, and every such edge is filed in y's
// band (the band of a y value is monotone in y), so one band is a complete
// candidate list. Built in linear time, unlike a box tree, and queried
// without descending one.
type CrossingRows = {
  readonly minY: number;
  readonly bandHeight: number;
  readonly bands: number;
  /** Band k holds edges[start[k] .. start[k + 1]). */
  readonly start: Int32Array;
  readonly from: Vec2[];
  readonly to: Vec2[];
};
const EDGES_PER_BAND = 2;
const MAX_BANDS = 1 << 16;
// Cooperative runs get a checkpoint per this many boundary points.
const CHECKPOINT_POINTS = 16;

function rayWinding(point: Vec2, rows: CrossingRows, orientation: ContourOrientation): number {
  let winding = 0;
  const band = bandOf(point.y, rows);
  const end = rows.start[band + 1] as number;
  // The half-open y test counts a shared vertex once and keeps the exact
  // boundary behaviour. An edge wholly left of the point cannot meet the
  // rightward ray (its orientation test would reject it too).
  for (let k = rows.start[band] as number; k < end; k += 1) {
    const a = rows.from[k] as Vec2;
    const b = rows.to[k] as Vec2;
    if (a.x < point.x && b.x < point.x) continue;
    if (a.y <= point.y && b.y > point.y && orientation.sign(a, b, point) > 0) winding += 1;
    if (a.y > point.y && b.y <= point.y && orientation.sign(a, b, point) < 0) winding -= 1;
  }
  return winding;
}

function bandOf(y: number, rows: BandLayout): number {
  const band = Math.floor((y - rows.minY) / rows.bandHeight);
  return band < 0 ? 0 : band >= rows.bands ? rows.bands - 1 : band;
}

type BandLayout = Pick<CrossingRows, 'minY' | 'bandHeight' | 'bands'>;

// Edge i runs from point i to point i + 1 around the ring; horizontal edges
// never cross a horizontal ray and are left out.
function crossingEdge(points: ReadonlyArray<Vec2>, i: number): [Vec2, Vec2] | null {
  const a = points[i];
  const b = points[(i + 1) % points.length];
  return a === undefined || b === undefined || a.y === b.y ? null : [a, b];
}

// About EDGES_PER_BAND edges per band, never much thinner than an edge is tall.
function crossingLayout(points: ReadonlyArray<Vec2>, bounds: ContourBox): BandLayout {
  let crossing = 0;
  let rise = 0;
  for (let i = 0; i < points.length; i += 1) {
    const edge = crossingEdge(points, i);
    if (edge === null) continue;
    crossing += 1;
    rise += Math.abs(edge[1].y - edge[0].y);
  }
  const span = bounds.maxY - bounds.minY;
  if (!(span > 0) || crossing === 0) return { minY: bounds.minY, bandHeight: 1, bands: 1 };
  const byHeight = Math.floor(span / ((rise / crossing) * 2));
  const bands = Math.max(1, Math.min(MAX_BANDS, Math.ceil(crossing / EDGES_PER_BAND), byHeight));
  return { minY: bounds.minY, bandHeight: span / bands, bands };
}

function* crossingRowsSteps(
  points: ReadonlyArray<Vec2>,
  bounds: ContourBox,
): TraceSteps<CrossingRows> {
  const cooperate = yield;
  const n = points.length;
  const layout = crossingLayout(points, bounds);
  // Band span of every crossing edge (-1 marks a horizontal one).
  const lows = new Int32Array(n).fill(-1);
  const highs = new Int32Array(n);
  const start = new Int32Array(layout.bands + 1);
  for (let i = 0; i < n; i += 1) {
    if (cooperate && i % CHECKPOINT_POINTS === 0) yield;
    const edge = crossingEdge(points, i);
    if (edge === null) continue;
    const [a, b] = edge;
    lows[i] = bandOf(Math.min(a.y, b.y), layout);
    highs[i] = bandOf(Math.max(a.y, b.y), layout);
    for (let k = lows[i] as number; k <= (highs[i] as number); k += 1) {
      start[k + 1] = (start[k + 1] as number) + 1;
    }
  }
  for (let k = 0; k < layout.bands; k += 1) {
    start[k + 1] = (start[k + 1] as number) + (start[k] as number);
  }
  return { ...layout, start, ...fillBands(points, lows, highs, start) };
}

function fillBands(
  points: ReadonlyArray<Vec2>,
  lows: Int32Array,
  highs: Int32Array,
  start: Int32Array,
): { readonly from: Vec2[]; readonly to: Vec2[] } {
  const n = points.length;
  const total = start[start.length - 1] as number;
  const next = start.slice(0, start.length - 1);
  const from = new Array<Vec2>(total);
  const to = new Array<Vec2>(total);
  for (let i = 0; i < n; i += 1) {
    const low = lows[i] as number;
    if (low < 0) continue;
    const a = points[i] as Vec2;
    const b = points[(i + 1) % n] as Vec2;
    for (let k = low; k <= (highs[i] as number); k += 1) {
      const slot = next[k] as number;
      next[k] = slot + 1;
      from[slot] = a;
      to[slot] = b;
    }
  }
  return { from, to };
}
