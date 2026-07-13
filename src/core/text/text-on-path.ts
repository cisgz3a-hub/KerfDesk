import {
  applyTransform,
  curveSubpathBounds,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type PathSegment,
  type PathTextSettings,
  type SceneObject,
  type Vec2,
} from '../scene';
import type { TextRenderResult } from './text-to-polylines';

export type PathTextResult =
  | { readonly kind: 'ok'; readonly rendered: TextRenderResult; readonly origin: Vec2 }
  | { readonly kind: 'invalid-guide' | 'text-too-long'; readonly message: string };

export function placeTextOnPath(
  rendered: TextRenderResult,
  guide: SceneObject,
  settings: PathTextSettings,
): PathTextResult {
  const guidePoints = guidePolyline(guide, settings.reverse);
  if (guidePoints === null) {
    return { kind: 'invalid-guide', message: 'Select a vector path with at least two points.' };
  }
  const metric = pathMetric(guidePoints);
  const offset = Math.max(0, settings.offsetMm);
  const textWidth = rendered.bounds.maxX - rendered.bounds.minX;
  if (offset + textWidth > metric.length + 1e-6) {
    return { kind: 'text-too-long', message: 'Text is longer than the available guide path.' };
  }
  const baseline = rendered.bounds.maxY;
  const map = (point: Vec2): Vec2 => {
    const sample = samplePath(metric, offset + point.x - rendered.bounds.minX);
    const height = baseline - point.y;
    return {
      x: sample.point.x + sample.normal.x * height,
      y: sample.point.y + sample.normal.y * height,
    };
  };
  const worldPaths = rendered.paths.map((path) => mapColoredPath(path, map));
  const bounds = boundsForPaths(worldPaths);
  return {
    kind: 'ok',
    rendered: normalizePaths(worldPaths, bounds),
    origin: { x: bounds.minX, y: bounds.minY },
  };
}

type PathMetric = {
  readonly points: ReadonlyArray<Vec2>;
  readonly cumulative: ReadonlyArray<number>;
  readonly length: number;
};

function guidePolyline(guide: SceneObject, reverse: boolean): ReadonlyArray<Vec2> | null {
  if (!('paths' in guide)) return null;
  const candidate = guide.paths
    .flatMap((path) => path.polylines)
    .find((line) => line.points.length >= 2);
  if (candidate === undefined) return null;
  const local = candidate.closed
    ? [...candidate.points, candidate.points[0] as Vec2]
    : [...candidate.points];
  const points = local.map((point) => applyTransform(point, guide.transform));
  return reverse ? [...points].reverse() : points;
}

function pathMetric(points: ReadonlyArray<Vec2>): PathMetric {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1] as Vec2;
    const current = points[index] as Vec2;
    cumulative.push(
      (cumulative[index - 1] ?? 0) + Math.hypot(current.x - previous.x, current.y - previous.y),
    );
  }
  return { points, cumulative, length: cumulative[cumulative.length - 1] ?? 0 };
}

function samplePath(
  metric: PathMetric,
  distance: number,
): { readonly point: Vec2; readonly normal: Vec2 } {
  const target = Math.max(0, Math.min(metric.length, distance));
  let index = 1;
  while (index < metric.cumulative.length - 1 && (metric.cumulative[index] ?? 0) < target)
    index += 1;
  const from = metric.points[index - 1] as Vec2;
  const to = metric.points[index] as Vec2;
  const start = metric.cumulative[index - 1] ?? 0;
  const segmentLength = Math.max(1e-12, (metric.cumulative[index] ?? start) - start);
  const ratio = (target - start) / segmentLength;
  const tangent = { x: (to.x - from.x) / segmentLength, y: (to.y - from.y) / segmentLength };
  return {
    point: { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio },
    normal: { x: tangent.y, y: -tangent.x },
  };
}

function mapColoredPath(path: ColoredPath, map: (point: Vec2) => Vec2): ColoredPath {
  return {
    ...path,
    polylines: path.polylines.map((line) => ({ ...line, points: line.points.map(map) })),
    ...(path.curves === undefined
      ? {}
      : { curves: path.curves.map((curve) => mapCurve(curve, map)) }),
  };
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
  const curves = paths.flatMap((path) => path.curves?.map(curveSubpathBounds) ?? []);
  const points = paths.flatMap((path) => path.polylines.flatMap((line) => line.points));
  const xs = [
    ...curves.flatMap((bounds) => [bounds.minX, bounds.maxX]),
    ...points.map((point) => point.x),
  ];
  const ys = [
    ...curves.flatMap((bounds) => [bounds.minY, bounds.maxY]),
    ...points.map((point) => point.y),
  ];
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function normalizePaths(paths: ReadonlyArray<ColoredPath>, bounds: Bounds): TextRenderResult {
  const shift = (point: Vec2): Vec2 => ({ x: point.x - bounds.minX, y: point.y - bounds.minY });
  return {
    paths: paths.map((path) => mapColoredPath(path, shift)),
    bounds: { minX: 0, minY: 0, maxX: bounds.maxX - bounds.minX, maxY: bounds.maxY - bounds.minY },
  };
}
