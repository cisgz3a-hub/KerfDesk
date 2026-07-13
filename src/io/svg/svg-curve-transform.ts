import type { CurveSubpath, Vec2 } from '../../core/scene';
import { arcToCubics } from './flatten-curves';

export type SvgMatrix = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

export function applySvgMatrix(matrix: SvgMatrix, point: Vec2): Vec2 {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function transformSvgCurveSubpath(path: CurveSubpath, matrix: SvgMatrix): CurveSubpath {
  const segments: CurveSubpath['segments'][number][] = [];
  let cursor = path.start;
  for (const segment of path.segments) {
    if (segment.kind === 'line') {
      segments.push({ kind: 'line', to: applySvgMatrix(matrix, segment.to) });
    } else if (segment.kind === 'cubic') {
      segments.push({
        kind: 'cubic',
        control1: applySvgMatrix(matrix, segment.control1),
        control2: applySvgMatrix(matrix, segment.control2),
        to: applySvgMatrix(matrix, segment.to),
      });
    } else {
      segments.push(...transformedArcCubics(cursor, segment, matrix));
    }
    cursor = segment.to;
  }
  return { start: applySvgMatrix(matrix, path.start), segments, closed: path.closed };
}

function transformedArcCubics(
  from: Vec2,
  segment: Extract<CurveSubpath['segments'][number], { readonly kind: 'elliptical-arc' }>,
  matrix: SvgMatrix,
): CurveSubpath['segments'] {
  return arcToCubics(from, segment.to, segment.radiusX, segment.radiusY, {
    rx: segment.radiusX,
    ry: segment.radiusY,
    xAxisRotationDeg: segment.rotationDeg,
    largeArc: segment.largeArc,
    sweep: segment.sweep,
  }).map((cubic) => ({
    kind: 'cubic' as const,
    control1: applySvgMatrix(matrix, cubic.p1),
    control2: applySvgMatrix(matrix, cubic.p2),
    to: applySvgMatrix(matrix, cubic.p3),
  }));
}
