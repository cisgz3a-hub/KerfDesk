// Bake an object's placement into its canonical curves, for Convert to Path
// (tools audit T1, T26-P2-1). LightBurn's Convert to Path keeps a circle as
// four curves; flattening it to its burn polyline left hundreds of nodes.
//
// Lines and cubics map exactly through their points. The affine image of an
// elliptical arc is again an elliptical arc (ADR-431), so a rotated, mirrored
// or non-uniformly scaled circle stays an arc. The scene stores arcs in SVG
// endpoint form, though, and re-deriving a very eccentric image's centre from
// its endpoints can drift. Where that endpoint form would not burn the mapped
// arc to a tenth of the machine tolerance, the arc is written as cubic Béziers
// instead, each spanning at most 45 degrees of the arc's parameter.
//
// Pure-core compliant: no clock, no random, no I/O, no DOM.

import { DEFAULT_MACHINE_CURVE_TOLERANCE_MM } from '../scene/curve-path';
import type {
  CubicPathSegment,
  CurveSubpath,
  EllipticalArcPathSegment,
  PathSegment,
  Vec2,
} from '../scene/scene-object';
import { transformCurveSubpathExact, type AffineMatrix } from '../vector-export/affine-curves';
import {
  artworkArcPoint,
  artworkArcReconstructionError,
  retainedArtworkArc,
  type ArtworkParametricArc,
} from '../vector-export/artwork-parametric-arc';

const ARC_PIECE_RAD = Math.PI / 4;

/** `curves` mapped through `matrix`, as plain scene segments that burn the mapped curve. */
export function bakePathCurves(
  curves: ReadonlyArray<CurveSubpath>,
  matrix: AffineMatrix,
  toleranceMm: number = DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
): ReadonlyArray<CurveSubpath> {
  return curves.map((curve) => {
    const mapped = transformCurveSubpathExact(curve, matrix);
    const segments: PathSegment[] = [];
    let from = mapped.start;
    for (const segment of mapped.segments) {
      segments.push(...sceneSegments(from, segment, toleranceMm / 10));
      from = segment.to;
    }
    return { ...mapped, segments };
  });
}

function sceneSegments(
  from: Vec2,
  segment: PathSegment,
  allowedErrorMm: number,
): ReadonlyArray<PathSegment> {
  if (segment.kind !== 'elliptical-arc') return [segment];
  const plain = plainArc(segment);
  const arc = retainedArtworkArc(segment);
  // The exact map tags its arcs with export-only parameters that the scene
  // never stores; keep the plain arc when its endpoint form burns the same.
  if (arc === null || artworkArcReconstructionError(from, segment) <= allowedErrorMm) {
    return [plain];
  }
  return arcCubics(arc, segment.to);
}

function plainArc(segment: EllipticalArcPathSegment): EllipticalArcPathSegment {
  const { kind, radiusX, radiusY, rotationDeg, largeArc, sweep, to } = segment;
  return { kind, radiusX, radiusY, rotationDeg, largeArc, sweep, to };
}

// The standard circle-arc cubic (handle length 4/3·tan(step/4)) carried
// through the arc's affine basis, which is exact for an ellipse's image.
function arcCubics(arc: ArtworkParametricArc, to: Vec2): ReadonlyArray<CubicPathSegment> {
  const count = Math.max(1, Math.ceil(Math.abs(arc.delta) / ARC_PIECE_RAD - 1e-9));
  const step = arc.delta / count;
  const handle = (4 / 3) * Math.tan(step / 4);
  const pieces: CubicPathSegment[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = arc.theta1 + step * index;
    const end = start + step;
    const p0 = artworkArcPoint(arc, start);
    const p3 = index === count - 1 ? to : artworkArcPoint(arc, end);
    const d0 = arcTangent(arc, start);
    const d3 = arcTangent(arc, end);
    pieces.push({
      kind: 'cubic',
      control1: { x: p0.x + handle * d0.x, y: p0.y + handle * d0.y },
      control2: { x: p3.x - handle * d3.x, y: p3.y - handle * d3.y },
      to: p3,
    });
  }
  return pieces;
}

function arcTangent(arc: ArtworkParametricArc, theta: number): Vec2 {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return { x: -arc.u.x * sin + arc.v.x * cos, y: -arc.u.y * sin + arc.v.y * cos };
}
