import {
  applyTransform,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type PathSegment,
  type PathTextSettings,
  type SceneObject,
  type Vec2,
} from '../scene';
import type { PathTextAcrossAlign } from '../scene/scene-object';
import type { TextRenderResult } from './text-to-polylines';
import { coloredPathsBounds } from './colored-paths-bounds';

export type PathTextResult =
  | { readonly kind: 'ok'; readonly rendered: TextRenderResult; readonly origin: Vec2 }
  | { readonly kind: 'invalid-guide' | 'text-too-long'; readonly message: string };

/**
 * Where the guide crosses a text, measured down from its first baseline: its
 * ink bottom, middle or top for on top of, centred on or hanging below. Absent
 * when the text has no anchor.
 */
export function pathTextAcrossFromBaseline(
  rendered: TextRenderResult,
  settings: PathTextSettings,
): number | undefined {
  if (rendered.anchor === undefined) return undefined;
  return acrossReferenceY(rendered.bounds, settings.acrossAlign ?? 'above') - rendered.anchor.y;
}

/**
 * Lays rendered text along the guide. `acrossFromBaseline` (from the
 * template's own render) puts a variable record's baseline where the
 * template's sits, instead of laying each record by its own ink.
 */
export function placeTextOnPath(
  rendered: TextRenderResult,
  guide: SceneObject,
  settings: PathTextSettings,
  acrossFromBaseline?: number,
): PathTextResult {
  const guidePoints = guidePolyline(guide, settings.reverse);
  if (guidePoints === null) {
    return { kind: 'invalid-guide', message: 'Select a vector path with at least two points.' };
  }
  const metric = pathMetric(guidePoints);
  const textWidth = rendered.bounds.maxX - rendered.bounds.minX;
  const start = alongStartMm(metric.length, textWidth, settings);
  if (start === null) {
    return { kind: 'text-too-long', message: 'Text is longer than the available guide path.' };
  }
  const baseline =
    acrossFromBaseline !== undefined && rendered.anchor !== undefined
      ? rendered.anchor.y + acrossFromBaseline
      : acrossReferenceY(rendered.bounds, settings.acrossAlign ?? 'above');
  const map = (point: Vec2): Vec2 => {
    const sample = samplePath(metric, start + point.x - rendered.bounds.minX);
    const height = baseline - point.y;
    return {
      x: sample.point.x + sample.normal.x * height,
      y: sample.point.y + sample.normal.y * height,
    };
  };
  const worldPaths = rendered.paths.map((path) => mapColoredPath(path, map));
  const bounds = coloredPathsBounds(worldPaths);
  return {
    kind: 'ok',
    rendered: normalizePaths(worldPaths, bounds),
    origin: { x: bounds.minX, y: bounds.minY },
  };
}

// Distance along the guide where the text's left edge lands, or null when the
// text (plus the offset) does not fit. The offset always pushes away from the
// aligned end: forward from the start, back from the end, forward from centre.
function alongStartMm(
  pathLength: number,
  textWidth: number,
  settings: PathTextSettings,
): number | null {
  const offset = Math.max(0, settings.offsetMm);
  const spare = pathLength - textWidth;
  const align = settings.alongAlign ?? 'start';
  const start = align === 'start' ? offset : align === 'end' ? spare - offset : spare / 2 + offset;
  return start < -1e-6 || start > spare + 1e-6 ? null : Math.max(0, start);
}

// The text line that lands on the guide: its bottom ('above': the text sits on
// the path), its middle, or its top ('below': the text hangs under the path).
function acrossReferenceY(bounds: Bounds, align: PathTextAcrossAlign): number {
  if (align === 'below') return bounds.minY;
  if (align === 'center') return (bounds.minY + bounds.maxY) / 2;
  return bounds.maxY;
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
  const points: Vec2[] = [];
  for (const point of candidate.points) {
    const world = applyTransform(point, guide.transform);
    const previous = points.at(-1);
    if (previous === undefined || Math.hypot(world.x - previous.x, world.y - previous.y) > 1e-12) {
      points.push(world);
    }
  }
  if (points.length < 2) return null;
  const first = points[0] as Vec2;
  const last = points.at(-1) as Vec2;
  if (candidate.closed && Math.hypot(last.x - first.x, last.y - first.y) > 1e-12)
    points.push(first);
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
  const index = firstSegmentReaching(metric.cumulative, target);
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

// The first index from 1 whose cumulative length reaches `target`, or the last
// index. A binary search finds the index the old forward scan found, since the
// lengths never decrease; the scan cost one step per guide point for every text
// point, 145 s for 2,000 characters on a 40,000-point guide (audit S7-P2-3).
function firstSegmentReaching(cumulative: ReadonlyArray<number>, target: number): number {
  let low = 1;
  let high = Math.max(1, cumulative.length - 1);
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((cumulative[middle] ?? 0) < target) low = middle + 1;
    else high = middle;
  }
  return low;
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

function normalizePaths(paths: ReadonlyArray<ColoredPath>, bounds: Bounds): TextRenderResult {
  const shift = (point: Vec2): Vec2 => ({ x: point.x - bounds.minX, y: point.y - bounds.minY });
  return {
    paths: paths.map((path) => mapColoredPath(path, shift)),
    bounds: { minX: 0, minY: 0, maxX: bounds.maxX - bounds.minX, maxY: bounds.maxY - bounds.minY },
  };
}
