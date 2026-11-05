import {
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type PathSegment,
  type Polyline,
  type Vec2,
} from '../scene';
import type { TextRenderResult } from './text-to-polylines';
import { coloredPathsBounds } from './colored-paths-bounds';

export const TEXT_BEND_MIN_DEG = -180;
export const TEXT_BEND_MAX_DEG = 180;

export function bendTextRender(rendered: TextRenderResult, bendDeg: number): TextRenderResult {
  const angleDeg = clampBend(bendDeg);
  const width = rendered.bounds.maxX - rendered.bounds.minX;
  if (Math.abs(angleDeg) < 1e-9 || width <= 0) return rendered;
  const bend = bendPointMapper(rendered.bounds, (angleDeg * Math.PI) / 180);
  const paths = rendered.paths.map((path) => bendColoredPath(path, bend));
  const bounds = coloredPathsBounds(paths);
  return normalizeBentPaths(
    paths,
    bounds,
    rendered.anchor === undefined ? undefined : bend(rendered.anchor),
  );
}

export function clampBend(value: number): number {
  const finite = Number.isFinite(value) ? value : 0;
  return Math.max(TEXT_BEND_MIN_DEG, Math.min(TEXT_BEND_MAX_DEG, finite));
}

/**
 * The bend's point map: every point keeps its distance along and across the
 * text's middle line, wrapped onto the arc. The alignment anchor on the first
 * baseline lands on one definite point, so bent variable records keep it.
 */
export function bendPointMapper(bounds: Bounds, angleRad: number): (point: Vec2) => Vec2 {
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

function normalizeBentPaths(
  paths: ReadonlyArray<ColoredPath>,
  bounds: Bounds,
  anchor: Vec2 | undefined,
): TextRenderResult {
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
    ...(anchor === undefined ? {} : { anchor: shift(anchor) }),
  };
}
