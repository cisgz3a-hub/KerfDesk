// path-snap-points — the named points one path offers, in its local coordinates
// (LightBurn gap LBG-F06): nodes, segment midpoints, and the centre of every
// closed subpath.
//
// Nodes and midpoints come from the path's canonical curves when it has them,
// so a circle offers its four real nodes and four true arc midpoints rather
// than every chord of its flattened outline. Paths without curves (older traces)
// use their polylines. Node numbering matches PathNodeRef.pointIndex exactly —
// curve anchor k, or polyline point k — so a node drag can name the nodes it is
// moving and keep them out of its own snap targets.
//
// Segment s always joins node s to node (s + 1) mod nodeCount; a closed subpath
// whose last node is not its first gets the closing segment too.

import {
  curveNodeCount,
  curveNodePoint,
  curveSubpathBounds,
  type ColoredPath,
  type CurveSubpath,
  type PathSegment,
  type Polyline,
  type Vec2,
} from '../../../core/scene';
import { ellipticalArcMidpoint } from '../../../core/scene/curve-path';

export const POINT_NODE = 0;
export const POINT_MIDPOINT = 1;
export const POINT_CENTER = 2;

export type PathSnapPoints = {
  readonly count: number;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly kinds: Uint8Array;
  // Subpath (curve or polyline) index within the path.
  readonly subpaths: Int32Array;
  // Node index for a node, segment index for a midpoint, -1 for a centre.
  readonly items: Int32Array;
  // Node count per subpath, for the (s + 1) mod n segment rule.
  readonly nodeCounts: Int32Array;
};

class PointCollector {
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  readonly kinds: number[] = [];
  readonly subpaths: number[] = [];
  readonly items: number[] = [];

  add(point: Vec2, kind: number, subpath: number, item: number): void {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    this.xs.push(point.x);
    this.ys.push(point.y);
    this.kinds.push(kind);
    this.subpaths.push(subpath);
    this.items.push(item);
  }
}

export function pathSnapPoints(path: ColoredPath): PathSnapPoints {
  const collector = new PointCollector();
  const nodeCounts =
    path.curves === undefined
      ? path.polylines.map((polyline, index) => addPolyline(collector, polyline, index))
      : path.curves.map((curve, index) => addCurve(collector, curve, index));
  return {
    count: collector.xs.length,
    xs: Float64Array.from(collector.xs),
    ys: Float64Array.from(collector.ys),
    kinds: Uint8Array.from(collector.kinds),
    subpaths: Int32Array.from(collector.subpaths),
    items: Int32Array.from(collector.items),
    nodeCounts: Int32Array.from(nodeCounts),
  };
}

function addCurve(collector: PointCollector, curve: CurveSubpath, subpath: number): number {
  const nodeCount = curveNodeCount(curve);
  for (let node = 0; node < nodeCount; node += 1) {
    const point = curveNodePoint(curve, node);
    if (point !== null) collector.add(point, POINT_NODE, subpath, node);
  }
  let from = curve.start;
  curve.segments.forEach((segment, index) => {
    if (!samePoint(from, segment.to)) {
      collector.add(segmentMidpoint(from, segment), POINT_MIDPOINT, subpath, index);
    }
    from = segment.to;
  });
  if (curve.closed && !samePoint(from, curve.start)) {
    collector.add(midpoint(from, curve.start), POINT_MIDPOINT, subpath, curve.segments.length);
  }
  if (curve.closed && curve.segments.length > 0) {
    collector.add(boxCentre(curveSubpathBounds(curve)), POINT_CENTER, subpath, -1);
  }
  return nodeCount;
}

function addPolyline(collector: PointCollector, polyline: Polyline, subpath: number): number {
  const points = polyline.points;
  points.forEach((point, node) => collector.add(point, POINT_NODE, subpath, node));
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from === undefined || to === undefined || samePoint(from, to)) continue;
    collector.add(midpoint(from, to), POINT_MIDPOINT, subpath, index);
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (polyline.closed && first !== undefined && last !== undefined && points.length > 2) {
    if (!samePoint(first, last)) {
      collector.add(midpoint(last, first), POINT_MIDPOINT, subpath, points.length - 1);
    }
    collector.add(boxCentre(pointsBox(points)), POINT_CENTER, subpath, -1);
  }
  return points.length;
}

// Halfway along a segment's parameter: B(0.5) for a cubic, the middle of the
// sweep for an arc — points ON the curve, never the chord's middle.
export function segmentMidpoint(from: Vec2, segment: PathSegment): Vec2 {
  if (segment.kind === 'line') return midpoint(from, segment.to);
  if (segment.kind === 'cubic') {
    return {
      x: (from.x + 3 * segment.control1.x + 3 * segment.control2.x + segment.to.x) / 8,
      y: (from.y + 3 * segment.control1.y + 3 * segment.control2.y + segment.to.y) / 8,
    };
  }
  return ellipticalArcMidpoint(from, segment);
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

function boxCentre(box: {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}): Vec2 {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

function pointsBox(points: ReadonlyArray<Vec2>): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}
