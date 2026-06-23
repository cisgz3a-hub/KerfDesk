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
): string {
  const header = svgOpen(width, height, physicalSize);
  const body = paths.map(coloredPathToSvgPath).join('');
  return `${header}${body}</svg>`;
}

export function countVisibleColoredPaths(paths: ReadonlyArray<ColoredPath>): number {
  return paths.filter(isVisibleColoredPath).length;
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

function coloredPathToSvgPath(path: ColoredPath): string {
  if (!isVisibleColor(path.color)) return '';
  const closed = path.polylines.filter((pl) => pl.closed && isVisibleClosedPolyline(pl));
  const open = path.polylines.filter((pl) => !pl.closed && isVisibleOpenPolyline(pl));
  const filled = closedPolylinesToSvgPath(path.color, closed);
  const stroked = openPolylinesToSvgPath(path.color, open);
  return `${filled}${stroked}`;
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

function openPolylinesToSvgPath(
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

function isVisibleColoredPath(path: ColoredPath): boolean {
  if (!isVisibleColor(path.color)) return false;
  return path.polylines.some((polyline) =>
    polyline.closed ? isVisibleClosedPolyline(polyline) : isVisibleOpenPolyline(polyline),
  );
}

function isVisibleColor(color: string): boolean {
  const normalized = color.trim().toLowerCase();
  return normalized !== '' && normalized !== 'none' && normalized !== 'transparent';
}

function isVisibleClosedPolyline(polyline: ColoredPath['polylines'][number]): boolean {
  const points = finitePoints(polyline);
  if (points.length < 3) return false;
  return Math.abs(signedArea(points)) > VISIBLE_GEOMETRY_EPSILON;
}

function isVisibleOpenPolyline(polyline: ColoredPath['polylines'][number]): boolean {
  const points = finitePoints(polyline);
  if (points.length < 2) return false;
  return pathLength(points) > VISIBLE_GEOMETRY_EPSILON;
}

function finitePoints(polyline: ColoredPath['polylines'][number]): ReadonlyArray<ColoredPath['polylines'][number]['points'][number]> {
  return polyline.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function signedArea(points: ReadonlyArray<ColoredPath['polylines'][number]['points'][number]>): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function pathLength(points: ReadonlyArray<ColoredPath['polylines'][number]['points'][number]>): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const point = points[i];
    if (prev === undefined || point === undefined) continue;
    length += Math.hypot(point.x - prev.x, point.y - prev.y);
  }
  return length;
}

function round(n: number): number {
  const k = Math.pow(10, ROUND_DP);
  return Math.round(n * k) / k;
}
