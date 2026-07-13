import {
  curveSubpathBounds,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type PathSegment,
  type Polyline,
  type Vec2,
} from '../scene';
import type { TextRenderResult } from './text-to-polylines';

export const TEXT_BEND_MIN_DEG = -180;
export const TEXT_BEND_MAX_DEG = 180;

export function bendTextRender(rendered: TextRenderResult, bendDeg: number): TextRenderResult {
  const angleDeg = clampBend(bendDeg);
  const width = rendered.bounds.maxX - rendered.bounds.minX;
  if (Math.abs(angleDeg) < 1e-9 || width <= 0) return rendered;
  const bend = bendPointMapper(rendered.bounds, (angleDeg * Math.PI) / 180);
  const paths = rendered.paths.map((path) => bendColoredPath(path, bend));
  const bounds = boundsForPaths(paths);
  return normalizeBentPaths(paths, bounds);
}

export function clampBend(value: number): number {
  const finite = Number.isFinite(value) ? value : 0;
  return Math.max(TEXT_BEND_MIN_DEG, Math.min(TEXT_BEND_MAX_DEG, finite));
}

function bendPointMapper(bounds: Bounds, angleRad: number): (point: Vec2) => Vec2 {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const radius = (bounds.maxX - bounds.minX) / angleRad;
  return (point) => {
    const theta = (point.x - centerX) / radius;
    const radial = radius - (point.y - centerY);
    return {
      x: centerX + radial * Math.sin(theta),
      y: centerY + radius - radial * Math.cos(theta),
    };
  };
}

function bendColoredPath(path: ColoredPath, bend: (point: Vec2) => Vec2): ColoredPath {
  return {
    ...path,
    polylines: path.polylines.map((polyline) => mapPolyline(polyline, bend)),
    ...(path.curves === undefined
      ? {}
      : { curves: path.curves.map((curve) => mapCurve(curve, bend)) }),
  };
}

function mapPolyline(polyline: Polyline, map: (point: Vec2) => Vec2): Polyline {
  return { ...polyline, points: polyline.points.map(map) };
}

function mapCurve(curve: CurveSubpath, map: (point: Vec2) => Vec2): CurveSubpath {
  return {
    ...curve,
    start: map(curve.start),
    segments: curve.segments.map((segment) => mapSegment(segment, map)),
  };
}

function mapSegment(segment: PathSegment, map: (point: Vec2) => Vec2): PathSegment {
  if (segment.kind === 'line') return { ...segment, to: map(segment.to) };
  if (segment.kind === 'cubic') {
    return {
      ...segment,
      control1: map(segment.control1),
      control2: map(segment.control2),
      to: map(segment.to),
    };
  }
  return { kind: 'line', to: map(segment.to) };
}

function boundsForPaths(paths: ReadonlyArray<ColoredPath>): Bounds {
  const curveBounds = paths.flatMap((path) => path.curves?.map(curveSubpathBounds) ?? []);
  const points = paths.flatMap((path) => path.polylines.flatMap((polyline) => polyline.points));
  const xs = [
    ...curveBounds.flatMap((bounds) => [bounds.minX, bounds.maxX]),
    ...points.map((p) => p.x),
  ];
  const ys = [
    ...curveBounds.flatMap((bounds) => [bounds.minY, bounds.maxY]),
    ...points.map((p) => p.y),
  ];
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function normalizeBentPaths(paths: ReadonlyArray<ColoredPath>, bounds: Bounds): TextRenderResult {
  const shift = (point: Vec2): Vec2 => ({ x: point.x - bounds.minX, y: point.y - bounds.minY });
  const normalized = paths.map((path) => bendColoredPath(path, shift));
  return {
    paths: normalized,
    bounds: {
      minX: 0,
      minY: 0,
      maxX: bounds.maxX - bounds.minX,
      maxY: bounds.maxY - bounds.minY,
    },
  };
}
