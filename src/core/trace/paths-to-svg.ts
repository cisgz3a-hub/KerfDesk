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

export function coloredPathsToSvg(
  paths: ReadonlyArray<ColoredPath>,
  width: number,
  height: number,
): string {
  const header = svgOpen(width, height);
  const body = paths.map(coloredPathToSvgPath).join('');
  return `${header}${body}</svg>`;
}

function svgOpen(width: number, height: number): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg"' +
    ` viewBox="0 0 ${width} ${height}"` +
    ' width="100%" height="100%"' +
    ' preserveAspectRatio="xMidYMid meet">'
  );
}

function coloredPathToSvgPath(path: ColoredPath): string {
  const d = path.polylines.map(polylineToSubPath).join(' ');
  if (d === '') return '';
  // Fill the path with the layer colour, no stroke — matches the
  // engrave intent (we're filling the silhouette, not outlining it).
  // fill-rule="evenodd" honours hole topology when an outer contour
  // and its hole live in the same ColoredPath.
  return `<path d="${d}" fill="${path.color}" fill-rule="evenodd" stroke="none"/>`;
}

function polylineToSubPath(polyline: ColoredPath['polylines'][number]): string {
  const points = polyline.points;
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

function round(n: number): number {
  const k = Math.pow(10, ROUND_DP);
  return Math.round(n * k) / k;
}
