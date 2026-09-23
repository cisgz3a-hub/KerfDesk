import { applyTransform } from '../scene/transform';
import type { CurveSubpath, PathSegment, Transform } from '../scene';

/** Bake the scene's scale, mirrors, rotation and translation without flattening
 * cubic or elliptical segments. The ellipse axes are the singular values of
 * the transformed ellipse matrix; reflections reverse its sweep. */
export function transformVectorCurve(curve: CurveSubpath, transform: Transform): CurveSubpath {
  const point = (value: CurveSubpath['start']) => applyTransform(value, transform);
  return {
    start: point(curve.start),
    closed: curve.closed,
    segments: curve.segments.map((segment): PathSegment => {
      if (segment.kind === 'line') return { ...segment, to: point(segment.to) };
      if (segment.kind === 'cubic') {
        return {
          ...segment,
          control1: point(segment.control1),
          control2: point(segment.control2),
          to: point(segment.to),
        };
      }
      return transformArc(segment, transform);
    }),
  };
}

function transformArc(
  arc: Extract<PathSegment, { readonly kind: 'elliptical-arc' }>,
  transform: Transform,
): PathSegment {
  const sx = transform.scaleX * (transform.mirrorX ? -1 : 1);
  const sy = transform.scaleY * (transform.mirrorY ? -1 : 1);
  const phi = (arc.rotationDeg * Math.PI) / 180;
  const a = sx * Math.cos(phi) * Math.abs(arc.radiusX);
  const b = sy * Math.sin(phi) * Math.abs(arc.radiusX);
  const c = -sx * Math.sin(phi) * Math.abs(arc.radiusY);
  const d = sy * Math.cos(phi) * Math.abs(arc.radiusY);
  const xx = a * a + c * c;
  const yy = b * b + d * d;
  const xy = a * b + c * d;
  const largest = (xx + yy + Math.hypot(xx - yy, 2 * xy)) / 2;
  const radiusX = Math.sqrt(largest);
  // det / largest avoids cancellation for long, thin ellipses.
  const radiusY = radiusX === 0 ? 0 : Math.abs(a * d - b * c) / radiusX;
  return {
    ...arc,
    to: applyTransform(arc.to, transform),
    radiusX,
    radiusY,
    rotationDeg: (Math.atan2(2 * xy, xx - yy) * 90) / Math.PI + transform.rotationDeg,
    sweep: sx * sy < 0 ? !arc.sweep : arc.sweep,
  };
}
