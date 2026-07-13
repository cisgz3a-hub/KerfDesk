import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  curveSubpathBounds,
  flattenCurveSubpath,
  type Bounds,
  type CurveSubpath,
  type Polyline,
  type Vec2,
} from '../../core/scene';
import { textToPolylines, type TextRenderResult } from '../../core/text';

export type GlyphCorpusFixture = {
  readonly name: string;
  readonly fontFile: string;
  readonly content: string;
  readonly sizeMm: number;
};

export type GlyphCorpusMetrics = {
  readonly contours: number;
  readonly curveSegments: number;
  readonly compatibilityPoints: number;
  readonly maxCompatibilityDeviationMm: number;
  readonly allFinite: boolean;
  readonly allClosed: boolean;
  readonly boundsContainGeometry: boolean;
};

const FONT_CASES = [
  { name: 'sans-counters', fontFile: 'Roboto-Regular.ttf', content: 'B8OQRS@%&' },
  { name: 'sans-diacritics', fontFile: 'Roboto-Regular.ttf', content: 'Crème brûlée 2026' },
  { name: 'mono-technical', fontFile: 'Inconsolata-Regular.ttf', content: 'M1lI0O {}[] /\\' },
  { name: 'script-connected', fontFile: 'Pacifico-Regular.ttf', content: 'Wedding Café' },
  { name: 'script-diacritics', fontFile: 'DancingScript-Regular.ttf', content: 'Ångström Noël' },
] as const;

const SIZES_MM = [3, 12, 50] as const;

export const REAL_GLYPH_CORPUS: ReadonlyArray<GlyphCorpusFixture> = FONT_CASES.flatMap((font) =>
  SIZES_MM.map((sizeMm) => ({ ...font, name: `${font.name}-${sizeMm}mm`, sizeMm })),
);

export async function renderGlyphFixture(fixture: GlyphCorpusFixture): Promise<TextRenderResult> {
  const bytes = readFileSync(resolve(__dirname, '../../ui/text/fonts', fixture.fontFile));
  const fontBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return textToPolylines({
    fontBuffer,
    content: fixture.content,
    sizeMm: fixture.sizeMm,
    alignment: 'left',
    lineHeight: 1.4,
    color: '#000000',
  });
}

export function measureGlyphRender(rendered: TextRenderResult): GlyphCorpusMetrics {
  const path = rendered.paths[0];
  const curves = path?.curves ?? [];
  const polylines = path?.polylines ?? [];
  let maxCompatibilityDeviationMm = 0;
  for (let index = 0; index < Math.min(curves.length, polylines.length); index += 1) {
    const curve = curves[index];
    const polyline = polylines[index];
    if (curve === undefined || polyline === undefined) continue;
    const flattened = flattenCurveSubpath(curve, { toleranceMm: 0.002 });
    if (flattened.kind !== 'ok') return failedMetrics(curves);
    maxCompatibilityDeviationMm = Math.max(
      maxCompatibilityDeviationMm,
      bidirectionalDeviation(flattened.polyline, polyline),
    );
  }
  return {
    contours: curves.length,
    curveSegments: curves.reduce((sum, curve) => sum + curve.segments.length, 0),
    compatibilityPoints: polylines.reduce((sum, polyline) => sum + polyline.points.length, 0),
    maxCompatibilityDeviationMm,
    allFinite: curves.every(curveIsFinite) && polylines.every(polylineIsFinite),
    allClosed: curves.every((curve) => curve.closed) && polylines.every((line) => line.closed),
    boundsContainGeometry: curves.every((curve) => curveInsideBounds(curve, rendered.bounds)),
  };
}

function failedMetrics(curves: ReadonlyArray<CurveSubpath>): GlyphCorpusMetrics {
  return {
    contours: curves.length,
    curveSegments: 0,
    compatibilityPoints: 0,
    maxCompatibilityDeviationMm: Number.POSITIVE_INFINITY,
    allFinite: false,
    allClosed: false,
    boundsContainGeometry: false,
  };
}

function curveIsFinite(curve: CurveSubpath): boolean {
  return (
    pointIsFinite(curve.start) &&
    curve.segments.every((segment) => {
      if (!pointIsFinite(segment.to)) return false;
      return (
        segment.kind !== 'cubic' ||
        (pointIsFinite(segment.control1) && pointIsFinite(segment.control2))
      );
    })
  );
}

function polylineIsFinite(polyline: Polyline): boolean {
  return polyline.points.every(pointIsFinite);
}

function pointIsFinite(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function curveInsideBounds(curve: CurveSubpath, bounds: Bounds): boolean {
  const measured = curveSubpathBounds(curve);
  return (
    pointInsideBounds({ x: measured.minX, y: measured.minY }, bounds) &&
    pointInsideBounds({ x: measured.maxX, y: measured.maxY }, bounds)
  );
}

function pointInsideBounds(point: Vec2, bounds: Bounds): boolean {
  const epsilon = 1e-7;
  return (
    point.x >= bounds.minX - epsilon &&
    point.x <= bounds.maxX + epsilon &&
    point.y >= bounds.minY - epsilon &&
    point.y <= bounds.maxY + epsilon
  );
}

function bidirectionalDeviation(left: Polyline, right: Polyline): number {
  return Math.max(
    directedDeviation(left.points, right.points),
    directedDeviation(right.points, left.points),
  );
}

function directedDeviation(from: ReadonlyArray<Vec2>, to: ReadonlyArray<Vec2>): number {
  let max = 0;
  for (const point of from) max = Math.max(max, distanceToPolyline(point, to));
  return max;
}

function distanceToPolyline(point: Vec2, polyline: ReadonlyArray<Vec2>): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < polyline.length; index += 1) {
    const from = polyline[index - 1];
    const to = polyline[index];
    if (from !== undefined && to !== undefined)
      best = Math.min(best, distanceToSegment(point, from, to));
  }
  return best;
}

function distanceToSegment(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}
