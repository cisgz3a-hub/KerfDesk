import type { Polyline, Vec2 } from '../scene';

const LEAF_SIZE = 8;

type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};
export type ContactSegment = Bounds & {
  readonly owner: number;
  readonly from: number;
  readonly to: number;
  readonly start: Vec2;
  readonly end: Vec2;
};
export type ContactIndex = Bounds &
  (
    | { readonly segments: ReadonlyArray<ContactSegment> }
    | { readonly left: ContactIndex; readonly right: ContactIndex }
  );

/** A balanced bounding-box index; no grid size, geometry cap or distance policy. */
export function polylineContactIndex(polylines: ReadonlyArray<Polyline>): ContactIndex | null {
  const segments = polylines.flatMap((polyline, owner) => {
    const count = contactPointCount(polyline);
    const edges = polyline.closed ? count : Math.max(0, count - 1);
    return Array.from({ length: edges }, (_, from) => {
      const to = (from + 1) % count;
      const start = polyline.points[from] as Vec2,
        end = polyline.points[to] as Vec2;
      return {
        owner,
        from,
        to,
        start,
        end,
        minX: Math.min(start.x, end.x),
        minY: Math.min(start.y, end.y),
        maxX: Math.max(start.x, end.x),
        maxY: Math.max(start.y, end.y),
      };
    }).filter((s) => [s.minX, s.minY, s.maxX, s.maxY].every(Number.isFinite));
  });
  return segments.length === 0 ? null : buildIndex(segments);
}

export function contactPointCount(polyline: Polyline): number {
  const first = polyline.points[0],
    last = polyline.points.at(-1);
  return polyline.closed &&
    polyline.points.length > 1 &&
    first?.x === last?.x &&
    first?.y === last?.y
    ? polyline.points.length - 1
    : polyline.points.length;
}

export function visitContactCandidates(
  point: Vec2,
  index: ContactIndex | null,
  visit: (segment: ContactSegment) => void,
): void {
  if (index === null || !containsPoint(index, point)) return;
  if ('segments' in index) {
    for (const segment of index.segments) if (containsPoint(segment, point)) visit(segment);
  } else {
    visitContactCandidates(point, index.left, visit);
    visitContactCandidates(point, index.right, visit);
  }
}

function containsPoint(bounds: Bounds, point: Vec2): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

function buildIndex(segments: ReadonlyArray<ContactSegment>): ContactIndex {
  const bounds = segments.reduce(
    (b, s) => ({
      minX: Math.min(b.minX, s.minX),
      minY: Math.min(b.minY, s.minY),
      maxX: Math.max(b.maxX, s.maxX),
      maxY: Math.max(b.maxY, s.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  if (segments.length <= LEAF_SIZE) return { ...bounds, segments };
  const isX = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY;
  const sorted = [...segments].sort((a, b) =>
    isX
      ? a.minX / 2 + a.maxX / 2 - (b.minX / 2 + b.maxX / 2)
      : a.minY / 2 + a.maxY / 2 - (b.minY / 2 + b.maxY / 2),
  );
  const middle = Math.floor(sorted.length / 2);
  return {
    ...bounds,
    left: buildIndex(sorted.slice(0, middle)),
    right: buildIndex(sorted.slice(middle)),
  };
}
