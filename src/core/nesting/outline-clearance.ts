type Point = { readonly x: number; readonly y: number };
type Outlines = ReadonlyArray<ReadonlyArray<Point>>;
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type Segment = { p: Point; q: Point; bounds: Bounds };
type SegmentIndex = { bounds: Bounds } & (
  | { segments: ReadonlyArray<Segment> }
  | { left: SegmentIndex; right: SegmentIndex }
);

/** Check the actual contour segments; rounded offset polygons are only an approximation. */
export function outlinesCloserThan(left: Outlines, right: Outlines, spacing: number): boolean {
  const threshold = spacing - 1e-7;
  if (threshold <= 0) return false;
  const segments = right.flatMap(pathSegments);
  if (segments.length === 0) return false;
  const index = segmentIndex(segments);
  return left.some((path) =>
    pathSegments(path).some((segment) => indexCloserThan(segment, index, threshold)),
  );
}
function pathSegments(path: ReadonlyArray<Point>): Segment[] {
  return path.flatMap((p, i) => {
    const q = path[(i + 1) % path.length];
    if (q === undefined) return [];
    return [
      {
        p,
        q,
        bounds: {
          minX: Math.min(p.x, q.x),
          minY: Math.min(p.y, q.y),
          maxX: Math.max(p.x, q.x),
          maxY: Math.max(p.y, q.y),
        },
      },
    ];
  });
}
// A balanced segment-box hierarchy prunes distant contour runs before the exact
// distance check, including when the two complete artwork bounds overlap.
function segmentIndex(segments: Segment[]): SegmentIndex {
  const bounds = segments.reduce(
    (box, segment) => ({
      minX: Math.min(box.minX, segment.bounds.minX),
      minY: Math.min(box.minY, segment.bounds.minY),
      maxX: Math.max(box.maxX, segment.bounds.maxX),
      maxY: Math.max(box.maxY, segment.bounds.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  if (segments.length <= 8) return { bounds, segments };
  const horizontal = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY;
  const centre = (segment: Segment): number =>
    horizontal
      ? segment.bounds.minX + segment.bounds.maxX
      : segment.bounds.minY + segment.bounds.maxY;
  segments.sort((a, b) => centre(a) - centre(b));
  const mid = Math.floor(segments.length / 2);
  return {
    bounds,
    left: segmentIndex(segments.slice(0, mid)),
    right: segmentIndex(segments.slice(mid)),
  };
}
function indexCloserThan(segment: Segment, index: SegmentIndex, threshold: number): boolean {
  if (separated(segment.bounds, index.bounds, threshold)) return false;
  if ('segments' in index)
    return index.segments.some(
      (other) =>
        !separated(segment.bounds, other.bounds, threshold) &&
        segmentsCloserThan(segment.p, segment.q, other.p, other.q, threshold * threshold),
    );
  return (
    indexCloserThan(segment, index.left, threshold) ||
    indexCloserThan(segment, index.right, threshold)
  );
}
function segmentsCloserThan(p: Point, q: Point, r: Point, s: Point, squared: number): boolean {
  return (
    crosses(p, q, r, s) ||
    distanceSquared(p, r, s) < squared ||
    distanceSquared(q, r, s) < squared ||
    distanceSquared(r, p, q) < squared ||
    distanceSquared(s, p, q) < squared
  );
}
function separated(a: Bounds, b: Bounds, threshold: number): boolean {
  return (
    a.maxX + threshold < b.minX ||
    b.maxX + threshold < a.minX ||
    a.maxY + threshold < b.minY ||
    b.maxY + threshold < a.minY
  );
}
function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
function distanceSquared(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}
