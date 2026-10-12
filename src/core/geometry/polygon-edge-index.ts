// An edge index over one polygon. It answers the same questions as the
// full-boundary scans in point-in-polygon.ts and segment-contained-in-polygon.ts
// with the same arithmetic, but consults only the edges a query can reach, so
// a test against an n-edge polygon costs about log n instead of n.
//
// Edge `i` runs from polygon[i] to polygon[(i + 1) % n], the closing edge
// included, exactly as the unindexed scans walk the boundary.
import type { Vec2 } from '../scene';
import { ContourBoxIndex } from '../trace/contour-box-index';

type EdgeBox = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly edge: number;
};

export class PolygonEdgeIndex {
  private constructor(
    readonly polygon: ReadonlyArray<Vec2>,
    private readonly edges: ContourBoxIndex<EdgeBox>,
    /** The longest edge, for callers that widen a query by edge length. */
    readonly maxEdgeLength: number,
    /** The largest absolute coordinate, for callers that scale tolerances. */
    readonly magnitude: number,
  ) {}

  /** Null when a coordinate is missing or not finite; callers then keep the
   * unindexed scan, whose comparisons define the behaviour for such input. */
  static create(polygon: ReadonlyArray<Vec2>): PolygonEdgeIndex | null {
    const boxes: EdgeBox[] = [];
    let maxEdgeLength = 0;
    let magnitude = 0;
    for (let edge = 0; edge < polygon.length; edge += 1) {
      const a = polygon[edge];
      const b = polygon[(edge + 1) % polygon.length];
      if (a === undefined || b === undefined || !finitePoint(a) || !finitePoint(b)) return null;
      boxes.push({
        minX: Math.min(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x),
        maxY: Math.max(a.y, b.y),
        edge,
      });
      maxEdgeLength = Math.max(maxEdgeLength, Math.hypot(b.x - a.x, b.y - a.y));
      magnitude = Math.max(magnitude, Math.abs(a.x), Math.abs(a.y));
    }
    return new PolygonEdgeIndex(polygon, ContourBoxIndex.create(boxes), maxEdgeLength, magnitude);
  }

  /** Exactly `pointInPolygon(point, polygon)`. Only an edge whose Y span holds
   * the point's Y can cross the ray, and each such edge is evaluated with the
   * same endpoint roles and expression; the even-odd toggle is order-free. */
  containsPoint(point: Vec2): boolean {
    const { polygon } = this;
    let inside = false;
    const query = { minX: -Infinity, minY: point.y, maxX: Infinity, maxY: point.y };
    for (const { edge } of this.edges.query(query)) {
      const a = polygon[(edge + 1) % polygon.length] as Vec2;
      const b = polygon[edge] as Vec2;
      const crossesY = a.y > point.y !== b.y > point.y;
      if (!crossesY) continue;
      const xAtY = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < xAtY) inside = !inside;
    }
    return inside;
  }

  /** Visit every edge whose box comes within `margin` of the given box, until
   * a visit returns true; returns whether one did. */
  forEachEdgeNear(
    box: {
      readonly minX: number;
      readonly minY: number;
      readonly maxX: number;
      readonly maxY: number;
    },
    margin: number,
    visit: (a: Vec2, b: Vec2) => boolean,
  ): boolean {
    const { polygon } = this;
    const query = {
      minX: box.minX - margin,
      minY: box.minY - margin,
      maxX: box.maxX + margin,
      maxY: box.maxY + margin,
    };
    for (const { edge } of this.edges.query(query)) {
      const a = polygon[edge] as Vec2;
      const b = polygon[(edge + 1) % polygon.length] as Vec2;
      if (visit(a, b)) return true;
    }
    return false;
  }
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
