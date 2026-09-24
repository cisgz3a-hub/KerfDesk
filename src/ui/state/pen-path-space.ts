// pen-path-space — moving pen geometry between scene space and an object's
// own coordinates (ADR-380). Lines and cubics survive any affine map exactly by
// mapping their points; elliptical arcs only survive a move into scene space.

import {
  applyTransform,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { transformVectorCurve } from '../../core/geometry/vector-curve-transform';

/** Inverse of applyTransform: undo translate, rotate, mirror, then scale. */
export function sceneToLocal(point: Vec2, transform: Transform): Vec2 {
  const dx = point.x - transform.x;
  const dy = point.y - transform.y;
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let x = dx * cos + dy * sin;
  let y = -dx * sin + dy * cos;
  if (transform.mirrorX) x = -x;
  if (transform.mirrorY) y = -y;
  return { x: x / transform.scaleX, y: y / transform.scaleY };
}

/** Map a line/cubic curve's points; arcs are handled by curveBetweenSpaces. */
export function mapCurvePoints(curve: CurveSubpath, map: (point: Vec2) => Vec2): CurveSubpath {
  return {
    ...curve,
    start: map(curve.start),
    segments: curve.segments.map((segment) =>
      segment.kind === 'cubic'
        ? {
            ...segment,
            control1: map(segment.control1),
            control2: map(segment.control2),
            to: map(segment.to),
          }
        : { ...segment, to: map(segment.to) },
    ),
  };
}

/**
 * A curve from one object's coordinates in another's, or null when it cannot
 * be expressed there exactly: an arc survives the move into scene space but
 * not an arbitrary change of basis.
 */
export function curveBetweenSpaces(
  curve: CurveSubpath,
  from: Transform,
  to: Transform,
): CurveSubpath | null {
  if (sameTransform(from, to)) return curve;
  if (!curve.segments.some((segment) => segment.kind === 'elliptical-arc')) {
    return mapCurvePoints(curve, (point) => sceneToLocal(applyTransform(point, from), to));
  }
  return sameTransform(to, IDENTITY_TRANSFORM) ? transformVectorCurve(curve, from) : null;
}

export function sameTransform(a: Transform, b: Transform): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.scaleX === b.scaleX &&
    a.scaleY === b.scaleY &&
    a.rotationDeg === b.rotationDeg &&
    a.mirrorX === b.mirrorX &&
    a.mirrorY === b.mirrorY
  );
}

export function isInvertibleTransform(transform: Transform): boolean {
  return (
    Number.isFinite(transform.scaleX) &&
    Number.isFinite(transform.scaleY) &&
    transform.scaleX !== 0 &&
    transform.scaleY !== 0
  );
}
