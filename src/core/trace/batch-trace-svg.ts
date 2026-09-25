// Standalone SVG for one Multi-File Trace result (ADR-403).
//
// Serializes the canonical trace curves (ColoredPath.curves: lines and
// cubics), not the dense compatibility polylines, in millimetres on a
// decimal grid. The page is the source image rectangle so the trace keeps
// registration with the image it came from. Paint follows the trace intent:
// filled contours fill closed curves even-odd with no stroke; Centerline
// strokes every curve; open curves are always stroked.
//
// Pure-core compliant: no clock, no random, no I/O, no DOM.

import { flattenCurveSubpath, polylineToCurveSubpath } from '../scene/curve-path';
import type { ColoredPath, CurveSubpath, Vec2 } from '../scene/scene-object';
import { transformCurveSubpathExact } from '../vector-export/affine-curves';
import { groupContoursWithHoles } from '../vector-export/contour-nesting';
import {
  DEFAULT_EXPORT_PRECISION_MM,
  decimalGridAtMost,
  formatOnGrid,
  type DecimalGrid,
} from '../vector-export/decimal-grid';
import { formatSvgPathData, quantizeCurves } from '../vector-export/svg-path-data';
import type { TraceOptions } from './trace-option-types';

export type TracedSvgPage = {
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** Absent: the file is written in source pixels with no physical size. */
  readonly physicalSizeMm?: { readonly widthMm: number; readonly heightMm: number };
};

export type TracedVectorOptions = {
  readonly precisionMm?: number;
  readonly groupContours?: boolean;
};

export type TracedLayer = { readonly color: string; readonly curves: ReadonlyArray<CurveSubpath> };

const VISIBLE_GEOMETRY_EPSILON = 1e-6;

/**
 * Visible traced geometry in page units (mm when a physical size is known),
 * one entry per visible colour. White and transparent are background.
 */
export function tracedLayers(
  paths: ReadonlyArray<ColoredPath>,
  page: TracedSvgPage,
  traceMode: TraceOptions['traceMode'],
): TracedLayer[] {
  const scale = pageScale(page);
  const matrix = { a: scale.x, b: 0, c: 0, d: scale.y, e: 0, f: 0 };
  const layers: TracedLayer[] = [];
  for (const path of paths) {
    if (!isVisibleColor(path.color)) continue;
    const curves = (path.curves ?? path.polylines.map(polylineToCurveSubpath))
      .filter((curve) => isVisibleCurve(curve, traceMode))
      .map((curve) => transformCurveSubpathExact(curve, matrix));
    if (curves.length > 0) layers.push({ color: path.color, curves });
  }
  return layers;
}

export function tracedLayersToSvg(
  layers: ReadonlyArray<TracedLayer>,
  page: TracedSvgPage,
  traceMode: TraceOptions['traceMode'],
  options: TracedVectorOptions = {},
): string {
  const scale = pageScale(page);
  const physical = page.physicalSizeMm !== undefined;
  // Pixel-unit files keep the historical exact coordinates.
  const grid = physical
    ? decimalGridAtMost(options.precisionMm ?? DEFAULT_EXPORT_PRECISION_MM)
    : null;
  const number = (value: number): string =>
    grid === null ? String(value) : formatOnGrid(value, grid);
  const width = number(page.pixelWidth * scale.x);
  const height = number(page.pixelHeight * scale.y);
  const size = physical
    ? ` width="${width}mm" height="${height}mm"`
    : ' width="100%" height="100%"';
  // One source pixel wide, as the preview draws it.
  const strokeWidth = number(Math.max(scale.x, scale.y));
  const body = layers
    .map((layer) =>
      layerMarkup(layer, grid, traceMode, strokeWidth, options.groupContours === true),
    )
    .join('');
  return (
    '<svg xmlns="http://www.w3.org/2000/svg"' +
    ` viewBox="0 0 ${width} ${height}"` +
    size +
    ' preserveAspectRatio="xMidYMid meet">' +
    body +
    '</svg>'
  );
}

function layerMarkup(
  layer: TracedLayer,
  grid: DecimalGrid | null,
  traceMode: TraceOptions['traceMode'],
  strokeWidth: string,
  group: boolean,
): string {
  const curves = quantizeCurves(layer.curves, grid);
  const fillClosed = traceMode !== 'centerline';
  const closed = fillClosed ? curves.filter((curve) => curve.closed) : [];
  const stroked = fillClosed ? curves.filter((curve) => !curve.closed) : curves;
  const fill = (members: ReadonlyArray<CurveSubpath>): string =>
    members.length === 0
      ? ''
      : `<path d="${formatSvgPathData(members, grid)}" fill="${layer.color}" fill-rule="evenodd" stroke="none"/>`;
  const filled = group
    ? groupContoursWithHoles(closed)
        .map(
          (g) => '<g>' + fill([g.outer, ...g.holes].map((i) => closed[i] as CurveSubpath)) + '</g>',
        )
        .join('')
    : fill(closed);
  const line =
    stroked.length === 0
      ? ''
      : `<path d="${formatSvgPathData(stroked, grid)}" fill="none" stroke="${layer.color}"` +
        ` stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return filled + line;
}

function pageScale(page: TracedSvgPage): { readonly x: number; readonly y: number } {
  const size = page.physicalSizeMm;
  if (size === undefined || !(page.pixelWidth > 0) || !(page.pixelHeight > 0)) {
    return { x: 1, y: 1 };
  }
  return { x: size.widthMm / page.pixelWidth, y: size.heightMm / page.pixelHeight };
}

function isVisibleColor(color: string): boolean {
  const normalized = color.trim().toLowerCase();
  if (normalized === '' || normalized === 'none' || normalized === 'transparent') return false;
  // Trace palettes use white as background, not burnable ink.
  return normalized !== '#fff' && normalized !== '#ffffff';
}

function isVisibleCurve(curve: CurveSubpath, traceMode: TraceOptions['traceMode']): boolean {
  if (curve.segments.length === 0) return false;
  const flattened = flattenCurveSubpath(curve, { toleranceMm: 0.05 });
  if (flattened.kind !== 'ok') return true;
  const points = flattened.polyline.points;
  if (curve.closed && traceMode !== 'centerline') {
    return Math.abs(signedArea(points)) > VISIBLE_GEOMETRY_EPSILON;
  }
  return pathLength(points, curve.closed) > VISIBLE_GEOMETRY_EPSILON;
}

function signedArea(points: ReadonlyArray<Vec2>): number {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as Vec2;
    const b = points[(i + 1) % points.length] as Vec2;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

function pathLength(points: ReadonlyArray<Vec2>, closed: boolean): number {
  let length = 0;
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = points[i] as Vec2;
    const b = points[(i + 1) % points.length] as Vec2;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}
