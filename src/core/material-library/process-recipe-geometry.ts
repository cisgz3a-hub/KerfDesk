import type { ColoredPath, SceneObject, Vec2 } from '../scene';
import type { ProcessRecipeGeometry } from './process-recipe';

/** Path groups are indivisible: a pocket's holes keep their original topology. */
export function recipePathGeometry(
  path: ColoredPath,
): Exclude<ProcessRecipeGeometry, 'any'> | null {
  if (path.polylines.length === 0) return null;
  if (path.polylines.every((line) => !line.closed)) return 'open';
  if (!path.polylines.every((line) => line.closed)) return null;
  return path.polylines.length === 1 && circularPoints(path.polylines[0]?.points ?? [])
    ? 'circular'
    : 'closed';
}
export function matchesRecipeGeometry(
  object: SceneObject,
  path: ColoredPath,
  geometry: ProcessRecipeGeometry,
): boolean {
  if (path.polylines.length === 0) return false;
  if (geometry === 'any') return true;
  if (geometry === 'closed') return path.polylines.every((line) => line.closed);
  if (geometry === 'open') return path.polylines.every((line) => !line.closed);
  // A nonuniformly transformed circle is an ellipse, not a circular drilling feature.
  return (
    Math.abs(Math.abs(object.transform.scaleX) - Math.abs(object.transform.scaleY)) < 1e-8 &&
    recipePathGeometry(path) === 'circular'
  );
}
function circularPoints(source: ReadonlyArray<Vec2>): boolean {
  const points =
    source.length > 1 && distance(source[0], source[source.length - 1]) < 1e-8
      ? source.slice(0, -1)
      : source;
  if (points.length < 8 || points.some((point) => !Number.isFinite(point.x + point.y)))
    return false;
  const center = circumcenter(
    points[0],
    points[Math.floor(points.length / 3)],
    points[Math.floor((points.length * 2) / 3)],
  );
  if (center === null) return false;
  const radius = distance(points[0], center);
  return (
    radius > 1e-8 &&
    points.every((point) => Math.abs(distance(point, center) - radius) <= radius * 0.005) &&
    fullOrderedSweep(points, center)
  );
}
function circumcenter(a: Vec2 | undefined, b: Vec2 | undefined, c: Vec2 | undefined): Vec2 | null {
  if (a === undefined || b === undefined || c === undefined) return null;
  const bx = b.x - a.x,
    by = b.y - a.y,
    cx = c.x - a.x,
    cy = c.y - a.y;
  const determinant = 2 * (bx * cy - by * cx);
  if (Math.abs(determinant) < 1e-12) return null;
  return {
    x: a.x + (cy * (bx * bx + by * by) - by * (cx * cx + cy * cy)) / determinant,
    y: a.y + (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) / determinant,
  };
}
function fullOrderedSweep(points: ReadonlyArray<Vec2>, center: Vec2): boolean {
  let sweep = 0;
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index],
      second = points[(index + 1) % points.length];
    if (first === undefined || second === undefined) return false;
    const delta = Math.atan2(
      (first.x - center.x) * (second.y - center.y) - (first.y - center.y) * (second.x - center.x),
      (first.x - center.x) * (second.x - center.x) + (first.y - center.y) * (second.y - center.y),
    );
    if (Math.abs(delta) > Math.PI / 3 || Math.abs(delta) < 1e-10) return false;
    if (sweep !== 0 && Math.sign(delta) !== Math.sign(sweep)) return false;
    sweep += delta;
  }
  return Math.abs(Math.abs(sweep) - Math.PI * 2) < 0.01;
}
function distance(a: Vec2 | undefined, b: Vec2 | undefined): number {
  return a === undefined || b === undefined ? Infinity : Math.hypot(a.x - b.x, a.y - b.y);
}
