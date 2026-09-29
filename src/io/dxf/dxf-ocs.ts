// Object Coordinate System (OCS) support for the DXF importer. CIRCLE, ARC,
// LWPOLYLINE, 2D POLYLINE and INSERT store their points in an OCS whose Z axis
// is the entity's extrusion direction (groups 210/220/230, default (0,0,1)).
// For the extrusion (0,0,-1), which 3D CAD writes for sketches on back-facing
// planes and for mirrored parts, the Arbitrary Axis Algorithm (Autodesk DXF
// Reference, "Object Coordinate Systems") gives OCS X = world -X and OCS Y =
// world Y, so those entities are converted as usual and then mirrored in X.
// Any other extrusion puts the entity on a tilted plane that a flat import
// cannot place without projecting it, so the caller skips it and says so.

import type { CurveSubpath, PathSegment, Polyline, Vec2 } from '../../core/scene';

export type DxfExtrusion = 'world' | 'mirrored' | 'tilted';

export const TILTED_PLANE_NOTE =
  'it lies on a plane tilted out of XY (extrusion not along Z), which a flat import cannot place';

// Largest XY part of the unit extrusion still read as exactly +Z or -Z. It
// absorbs the float32 round-off some exporters leave (cos 90 degrees is about
// 4.4e-8 there); ignoring a tilt that small moves a point by about a millionth
// of its elevation, far below any cutting tolerance.
const EXTRUSION_AXIS_TOLERANCE = 1e-6;

export function classifyExtrusion(x: number, y: number, z: number): DxfExtrusion {
  const length = Math.hypot(x, y, z);
  // A zero vector has no direction at all; read it like the default.
  if (!(length > 0)) return 'world';
  if (Math.hypot(x, y) / length > EXTRUSION_AXIS_TOLERANCE) return 'tilted';
  return z > 0 ? 'world' : 'mirrored';
}

// 0 - x rather than -x, so a point on the Y axis keeps a positive zero.
export function mirrorPointX(point: Vec2): Vec2 {
  return { x: 0 - point.x, y: point.y };
}

export function mirrorPolylineX(polyline: Polyline): Polyline {
  return { points: polyline.points.map(mirrorPointX), closed: polyline.closed };
}

export function mirrorCurveX(curve: CurveSubpath): CurveSubpath {
  return {
    start: mirrorPointX(curve.start),
    segments: curve.segments.map(mirrorSegmentX),
    closed: curve.closed,
  };
}

function mirrorSegmentX(segment: PathSegment): PathSegment {
  switch (segment.kind) {
    case 'line':
      return { kind: 'line', to: mirrorPointX(segment.to) };
    case 'cubic':
      return {
        kind: 'cubic',
        control1: mirrorPointX(segment.control1),
        control2: mirrorPointX(segment.control2),
        to: mirrorPointX(segment.to),
      };
    case 'elliptical-arc':
      // A mirror reverses the turning direction and reflects the ellipse's tilt.
      return {
        ...segment,
        rotationDeg: 0 - segment.rotationDeg,
        sweep: !segment.sweep,
        to: mirrorPointX(segment.to),
      };
  }
}
