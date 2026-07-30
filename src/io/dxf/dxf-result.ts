import {
  curveSubpathBounds,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Polyline,
} from '../../core/scene';
import type { ColoredPolyline, ExpandOutcome } from './dxf-expand';

export type ParseDxfResult =
  | { readonly kind: 'error'; readonly reason: string }
  | {
      readonly kind: 'ok';
      readonly object: ImportedSvg | null;
      readonly pathCount: number;
      readonly notes: ReadonlyArray<string>;
      readonly skippedSummary: string | null;
    };

export function buildDxfResult(
  args: { readonly id: string; readonly source: string },
  expanded: ExpandOutcome,
  metadataNotes: ReadonlyArray<string>,
): ParseDxfResult {
  const notes = [...metadataNotes, ...expanded.notes];
  const skippedSummary = formatSkipped(expanded.skipped);
  const paths = normalizeAndGroup(expanded.polylines);
  if (paths.length === 0) {
    return { kind: 'ok', object: null, pathCount: 0, notes, skippedSummary };
  }
  return {
    kind: 'ok',
    object: {
      kind: 'imported-svg',
      id: args.id,
      source: args.source,
      bounds: pathsBounds(paths),
      transform: IDENTITY_TRANSFORM,
      paths,
    },
    pathCount: paths.reduce((count, path) => count + path.polylines.length, 0),
    notes,
    skippedSummary,
  };
}

function normalizeAndGroup(polylines: ReadonlyArray<ColoredPolyline>): ColoredPath[] {
  if (polylines.length === 0) return [];
  let minX = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { curve } of polylines) {
    const bounds = curveSubpathBounds(curve);
    minX = Math.min(minX, bounds.minX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  const byColor = new Map<string, { polylines: Polyline[]; curves: CurveSubpath[] }>();
  const point = (value: { readonly x: number; readonly y: number }) => ({
    x: value.x - minX,
    y: maxY - value.y,
  });
  for (const { color, polyline, curve } of polylines) {
    const normalized: Polyline = {
      closed: polyline.closed,
      points: polyline.points.map(point),
    };
    const normalizedCurve = transformNormalizedCurve(curve, point);
    const bucket = byColor.get(color);
    if (bucket === undefined) {
      byColor.set(color, { polylines: [normalized], curves: [normalizedCurve] });
    } else {
      bucket.polylines.push(normalized);
      bucket.curves.push(normalizedCurve);
    }
  }
  return [...byColor.entries()].map(([color, bucket]) => ({ color, ...bucket }));
}

function transformNormalizedCurve(
  curve: CurveSubpath,
  point: (value: { readonly x: number; readonly y: number }) => { x: number; y: number },
): CurveSubpath {
  return {
    start: point(curve.start),
    segments: curve.segments.map((segment) => {
      if (segment.kind === 'line') return { ...segment, to: point(segment.to) };
      if (segment.kind === 'cubic') {
        return {
          ...segment,
          control1: point(segment.control1),
          control2: point(segment.control2),
          to: point(segment.to),
        };
      }
      return { ...segment, sweep: !segment.sweep, to: point(segment.to) };
    }),
    closed: curve.closed,
  };
}

function pathsBounds(paths: ReadonlyArray<ColoredPath>): ImportedSvg['bounds'] {
  let maxX = 0;
  let maxY = 0;
  for (const path of paths) {
    if (path.curves !== undefined) {
      for (const curve of path.curves) {
        const bounds = curveSubpathBounds(curve);
        maxX = Math.max(maxX, bounds.maxX);
        maxY = Math.max(maxY, bounds.maxY);
      }
      continue;
    }
    for (const polyline of path.polylines) {
      for (const point of polyline.points) {
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
      }
    }
  }
  return { minX: 0, minY: 0, maxX, maxY };
}

function formatSkipped(skipped: ReadonlyMap<string, number>): string | null {
  if (skipped.size === 0) return null;
  return [...skipped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${count} ${type}`)
    .join(', ');
}
