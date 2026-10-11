type Point = { readonly x: number; readonly y: number };
type Outlines = ReadonlyArray<ReadonlyArray<Point>>;

/** Check the actual contour segments; rounded offset polygons are only an approximation. */
export function outlinesCloserThan(left: Outlines, right: Outlines, spacing: number): boolean {
  const threshold = spacing - 1e-7;
  if (threshold <= 0) return false;
  return left.some((a) => right.some((b) => pathsCloserThan(a, b, threshold)));
}
function pathsCloserThan(
  a: ReadonlyArray<Point>,
  b: ReadonlyArray<Point>,
  threshold: number,
): boolean {
  const squared = threshold * threshold;
  for (let i = 0; i < a.length; i += 1)
    for (let j = 0; j < b.length; j += 1) {
      const p = a[i],
        q = a[(i + 1) % a.length];
      const r = b[j],
        s = b[(j + 1) % b.length];
      if (p === undefined || q === undefined || r === undefined || s === undefined) continue;
      if (separated(p, q, r, s, threshold)) continue;
      if (segmentsCloserThan(p, q, r, s, squared)) return true;
    }
  return false;
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
function separated(p: Point, q: Point, r: Point, s: Point, threshold: number): boolean {
  return (
    Math.max(p.x, q.x) + threshold < Math.min(r.x, s.x) ||
    Math.max(r.x, s.x) + threshold < Math.min(p.x, q.x) ||
    Math.max(p.y, q.y) + threshold < Math.min(r.y, s.y) ||
    Math.max(r.y, s.y) + threshold < Math.min(p.y, q.y)
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
