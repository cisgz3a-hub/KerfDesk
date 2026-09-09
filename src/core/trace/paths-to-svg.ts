// Pure stringifier from ColoredPath[] → SVG string. Used by the live
// preview so it renders the SAME geometry the commit path produces,
// instead of going through imagetracerjs's imagedataToSVG branch
// separately. Single source of truth for what the user sees vs. what
// engraves.
//
// Output shape:
//   <svg xmlns viewBox width height preserveAspectRatio>
//     <path d="M x y L x y L x y Z M ..." fill="#color" stroke="none"/>
//     ...
//   </svg>
//
// One <path> per ColoredPath; subpaths within a path are concatenated
// in the same `d` attribute, separated by `M` move commands. Closed
// polylines end with `Z`. Numbers are rounded to 2 decimals — the
// preview is rendered at screen resolution, sub-pixel precision is
// invisible and costs bytes.
//
// Pure-core compliant: no clock, no random, no I/O, no DOM.

import type { ColoredPath } from '../scene';
import type { TraceOptions } from './trace-option-types';

// Decimal-rounding precision. 2 dp = 0.01px on a 400px preview ≈
// 0.0025% of width — well below display resolution. Higher precision
// just inflates the string.
const ROUND_DP = 2;
const VISIBLE_GEOMETRY_EPSILON = 1e-6;

export type SvgPhysicalSize = {
  readonly widthMm: number;
  readonly heightMm: number;
};

export function coloredPathsToSvg(
  paths: ReadonlyArray<ColoredPath>,
  width: number,
  height: number,
  physicalSize?: SvgPhysicalSize,
  traceMode?: TraceOptions['traceMode'],
): string {
  const header = svgOpen(width, height, physicalSize);
  const body = paths.map((path) => coloredPathToSvgPath(path, traceMode)).join('');
  return `${header}${body}</svg>`;
}

export function countVisibleColoredPaths(
  paths: ReadonlyArray<ColoredPath>,
  traceMode?: TraceOptions['traceMode'],
): number {
  return paths.filter((path) => isVisibleColoredPath(path, traceMode)).length;
}

function svgOpen(width: number, height: number, physicalSize?: SvgPhysicalSize): string {
  const sizeAttrs =
    physicalSize === undefined
      ? ' width="100%" height="100%"'
      : ` width="${round(physicalSize.widthMm)}mm" height="${round(physicalSize.heightMm)}mm"`;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg"' +
    ` viewBox="0 0 ${width} ${height}"` +
    sizeAttrs +
    ' preserveAspectRatio="xMidYMid meet">'
  );
}

function coloredPathToSvgPath(path: ColoredPath, traceMode: TraceOptions['traceMode']): string {
  if (!isVisibleColor(path.color)) return '';
  const closedVisible =
    traceMode === 'centerline' ? isVisibleStrokedPolyline : isVisibleClosedPolyline;
  const closed = path.polylines.filter((pl) => pl.closed && closedVisible(pl));
  const open = path.polylines.filter((pl) => !pl.closed && isVisibleStrokedPolyline(pl));
  // A closed Centerline is still a line operation; closure does not imply fill.
  const closedSvg =
    traceMode === 'centerline'
      ? strokedPolylinesToSvgPath(path.color, closed)
      : closedPolylinesToSvgPath(path.color, closed);
  const openSvg = strokedPolylinesToSvgPath(path.color, open);
  return `${closedSvg}${openSvg}`;
}

function closedPolylinesToSvgPath(
  color: string,
  polylines: ReadonlyArray<ColoredPath['polylines'][number]>,
): string {
  const d = polylines.map(polylineToSubPath).join(' ');
  if (d === '') return '';
  // Fill the path with the layer colour, no stroke — matches the
  // engrave intent (we're filling the silhouette, not outlining it).
  // fill-rule="evenodd" honours hole topology when an outer contour
  // and its hole live in the same ColoredPath.
  return `<path d="${d}" fill="${color}" fill-rule="evenodd" stroke="none"/>`;
}

function strokedPolylinesToSvgPath(
  color: string,
  polylines: ReadonlyArray<ColoredPath['polylines'][number]>,
): string {
  const d = polylines.map(polylineToSubPath).join(' ');
  if (d === '') return '';
  return (
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="1"` +
    ' stroke-linecap="round" stroke-linejoin="round"/>'
  );
}

function polylineToSubPath(polyline: ColoredPath['polylines'][number]): string {
  const points = finitePoints(polyline);
  if (points.length === 0) return '';
  const first = points[0];
  if (first === undefined) return '';
  let d = `M${round(first.x)} ${round(first.y)}`;
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i];
    if (p === undefined) continue;
    d += ` L${round(p.x)} ${round(p.y)}`;
  }
  if (polyline.closed) d += ' Z';
  return d;
}

function isVisibleColoredPath(path: ColoredPath, traceMode: TraceOptions['traceMode']): boolean {
  if (!isVisibleColor(path.color)) return false;
  return path.polylines.some((polyline) =>
    polyline.closed && traceMode !== 'centerline'
      ? isVisibleClosedPolyline(polyline)
      : isVisibleStrokedPolyline(polyline),
  );
}

function isVisibleColor(color: string): boolean {
  const normalized = color.trim().toLowerCase();
  if (normalized === '' || normalized === 'none' || normalized === 'transparent') return false;
  // Trace palettes use white as background, not burnable ink. Treating it as
  // visible lets batch trace export SVGs that look blank in normal viewers.
  return normalized !== '#fff' && normalized !== '#ffffff';
}

function isVisibleClosedPolyline(polyline: ColoredPath['polylines'][number]): boolean {
  const points = finitePoints(polyline);
  if (points.length < 3) return false;
  return Math.abs(signedArea(points)) > VISIBLE_GEOMETRY_EPSILON;
}

function isVisibleStrokedPolyline(polyline: ColoredPath['polylines'][number]): boolean {
  const points = finitePoints(polyline);
  if (points.length < 2) return false;
  return pathLength(points, polyline.closed) > VISIBLE_GEOMETRY_EPSILON;
}

function finitePoints(
  polyline: ColoredPath['polylines'][number],
): ReadonlyArray<ColoredPath['polylines'][number]['points'][number]> {
  return polyline.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function signedArea(
  points: ReadonlyArray<ColoredPath['polylines'][number]['points'][number]>,
): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function pathLength(
  points: ReadonlyArray<ColoredPath['polylines'][number]['points'][number]>,
  closed: boolean,
): number {
  let length = 0;
  const segments = closed ? points.length : points.length - 1;
  for (let i = 0; i < segments; i += 1) {
    const prev = points[i];
    const point = points[(i + 1) % points.length];
    if (prev === undefined || point === undefined) continue;
    length += Math.hypot(point.x - prev.x, point.y - prev.y);
  }
  return length;
}

function round(n: number): number {
  const k = Math.pow(10, ROUND_DP);
  return Math.round(n * k) / k;
}
