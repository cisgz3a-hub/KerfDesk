import type { ColoredPath, CurveSubpath, Polyline, Vec2 } from './scene-object';

/** Omit only an exactly redundant line representation; present curves remain authoritative. */
export function compactLineGeometry(path: ColoredPath): ColoredPath {
  if (
    path.curves === undefined ||
    path.curves.length !== path.polylines.length ||
    !path.curves.every((curve, index) => matchesPolyline(curve, path.polylines[index]))
  ) {
    return path;
  }
  const { curves: _redundantCurves, ...compact } = path;
  return compact;
}

function matchesPolyline(curve: CurveSubpath, polyline: Polyline | undefined): boolean {
  if (
    polyline === undefined ||
    polyline.closed !== curve.closed ||
    polyline.points.length !== curve.segments.length + 1 ||
    !sameFinitePoint(curve.start, polyline.points[0])
  ) {
    return false;
  }
  return curve.segments.every(
    (segment, index) =>
      segment.kind === 'line' && sameFinitePoint(segment.to, polyline.points[index + 1]),
  );
}

function sameFinitePoint(a: Vec2, b: Vec2 | undefined): boolean {
  return (
    b !== undefined && Number.isFinite(a.x) && Number.isFinite(a.y) && a.x === b.x && a.y === b.y
  );
}
