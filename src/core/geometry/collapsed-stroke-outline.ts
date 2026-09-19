import { FillRule, unionD, type PathsD } from 'clipper2-ts';
import type { Polyline, StrokeTransform, Vec2 } from '../scene/scene-object';
import {
  isClosedPolygon,
  pathDToPolyline,
  polylineToPathD,
  tryVectorOp,
} from './vector-path-tools';

/** A rank-one circular pen is a line segment, which can still sweep area after node edits. */
export function collapsedStrokeOutline(
  polylines: ReadonlyArray<Polyline>,
  radiusMm: number,
  transform: StrokeTransform,
): ReadonlyArray<Polyline> | null | undefined {
  const pen = collapsedPenVector(radiusMm, transform);
  // Undefined selects ordinary invertible expansion; null is arithmetic failure.
  if (pen === undefined || pen === null) return pen;
  if (pen.x === 0 && pen.y === 0) return [];
  const paths = sweptStripPaths(polylines, pen);
  return paths === null ? null : uniteSweptStrips(paths);
}

function sweptStripPaths(polylines: ReadonlyArray<Polyline>, pen: Vec2): PathsD | null {
  const paths: PathsD = [];
  for (const polyline of polylines) {
    const count = polyline.closed ? polyline.points.length : polyline.points.length - 1;
    for (let i = 0; i < count; i++) {
      const a = polyline.points[i];
      const b = polyline.points[(i + 1) % polyline.points.length];
      if (a === undefined || b === undefined) continue;
      const cross = (b.x - a.x) * pen.y - (b.y - a.y) * pen.x;
      if (cross === 0) continue;
      const points = [
        { x: a.x - pen.x, y: a.y - pen.y },
        { x: b.x - pen.x, y: b.y - pen.y },
        { x: b.x + pen.x, y: b.y + pen.y },
        { x: a.x + pen.x, y: a.y + pen.y },
      ];
      if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
        return null;
      // Every segment contributes material, including at a turn or overlap.
      paths.push(polylineToPathD({ closed: true, points: cross < 0 ? points.reverse() : points }));
    }
  }
  return paths;
}

function uniteSweptStrips(paths: PathsD): ReadonlyArray<Polyline> | null {
  const outlined = tryVectorOp(() => unionD(paths, [], FillRule.NonZero, 3));
  return outlined.kind === 'error'
    ? null
    : outlined.value.map(pathDToPolyline).filter(isClosedPolygon);
}

function collapsedPenVector(radiusMm: number, transform: StrokeTransform): Vec2 | null | undefined {
  const scale = Math.max(
    Math.abs(transform.a),
    Math.abs(transform.b),
    Math.abs(transform.c),
    Math.abs(transform.d),
  );
  if (!Number.isFinite(scale)) return null;
  if (scale === 0) return { x: 0, y: 0 };
  const a = transform.a / scale;
  const b = transform.b / scale;
  const c = transform.c / scale;
  const d = transform.d / scale;
  // Scaling before the determinant distinguishes rank one from an invertible
  // tiny matrix whose unscaled determinant merely underflowed to zero.
  if (!isNumericallyRankOne(a, b, c, d, radiusMm * scale)) return undefined;
  const firstLength = Math.hypot(a, b);
  const secondLength = Math.hypot(c, d);
  const [x, y, length] = firstLength >= secondLength ? [a, b, firstLength] : [c, d, secondLength];
  const ux = x / length;
  const uy = y / length;
  const extent = radiusMm * scale * Math.hypot(a * ux + b * uy, c * ux + d * uy);
  const result = { x: ux * extent, y: uy * extent };
  return Number.isFinite(result.x) && Number.isFinite(result.y) ? result : null;
}

function isNumericallyRankOne(
  a: number,
  b: number,
  c: number,
  d: number,
  radiusMm: number,
): boolean {
  const determinant = a * d - b * c;
  if (determinant === 0) return true;
  // Composing a genuine collapsed pen can leave roundoff in its determinant.
  // Accept cancellation only at floating precision, with at most 1e-9 mm of
  // transverse pen extent. A tiny nonzero diagonal is not cancellation.
  const roundoff = Number.EPSILON * 8 * (Math.abs(a * d) + Math.abs(b * c));
  const transverse =
    (radiusMm * Math.abs(determinant)) / Math.max(Math.hypot(a, b), Math.hypot(c, d));
  return Math.abs(determinant) <= roundoff && transverse <= 1e-9;
}
