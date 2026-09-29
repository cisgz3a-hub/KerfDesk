// shape-to-polylines — converts a single SVG primitive element (rect, line,
// polyline, polygon, circle, ellipse, path) into a list of subpaths in
// object-local coordinates. Color/stroke attribution is handled by the caller
// in parse-svg.ts.
//
// Phase A scope: the seven primitive elements above. Curves inside <path d>
// are flattened via parsePathD's Phase-A lossy approach (endpoint-only). The
// SVG spec also defines <use>, <g>, <symbol>, gradients, masks, clip-paths,
// patterns — these are walked transparently in parse-svg.ts where applicable.

import { DEFAULT_MACHINE_CURVE_TOLERANCE_MM, type Vec2 } from '../../core/scene';
import { DEFAULT_FLATNESS_MM } from './flatten-curves';
import { parsePathD, type SubPath } from './parse-path-d';
import { closureToleranceUserUnits, endsMeet } from './subpath-closure';
import { parseSvgLengthUserUnitsOrNull } from './svg-units';

const POINT_NUMBER_RE = /[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/g;

// `scale` is the local user→mm distance stretch (from the accumulated import
// transform). Curve/arc flattening decides its tolerance in mm, so it is divided
// through here to stay 0.25 mm in scene space instead of 0.25 user units — which
// on a small-viewBox / large-physical SVG was several mm of faceting (audit C2).
// The default of 1 keeps every existing caller byte-identical.
export function elementToSubPaths(el: Element, scale = 1): ReadonlyArray<SubPath> {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'path':
      return pathToSubs(el, scale);
    case 'line':
      return lineToSubs(el);
    case 'polyline':
      return polylineToSubs(el, false, scale);
    case 'polygon':
      return polylineToSubs(el, true, scale);
    case 'rect':
      return rectToSubs(el, scale);
    case 'circle':
      return circleToSubs(el, scale);
    case 'ellipse':
      return ellipseToSubs(el, scale);
    default:
      return [];
  }
}

// Guard the divisor: a degenerate (zero/NaN) transform falls back to 1 rather
// than producing an infinite or NaN tolerance.
function positiveScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function numAttr(el: Element, name: string, fallback = 0): number {
  const raw = el.getAttribute(name);
  if (raw === null) return fallback;
  // SVG absolute units resolve to CSS-pixel user units before the accumulated
  // viewBox/root transform maps them into scene millimetres. Preserve the
  // historical numeric-prefix fallback for unsupported/malformed units; strict
  // import refusal is a separate maintainer-owned policy decision.
  const parsed = parseSvgLengthUserUnitsOrNull(raw) ?? Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumAttr(el: Element, name: string): number | null {
  const raw = el.getAttribute(name);
  if (raw === null) return null;
  const parsed = parseSvgLengthUserUnitsOrNull(raw) ?? Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function pathToSubs(el: Element, scale: number): ReadonlyArray<SubPath> {
  const d = el.getAttribute('d');
  if (d === null || d.trim() === '') return [];
  return parsePathD(d, DEFAULT_FLATNESS_MM / positiveScale(scale), scale);
}

function lineToSubs(el: Element): ReadonlyArray<SubPath> {
  const x1 = numAttr(el, 'x1');
  const y1 = numAttr(el, 'y1');
  const x2 = numAttr(el, 'x2');
  const y2 = numAttr(el, 'y2');
  return [
    {
      points: [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      ],
      closed: false,
    },
  ];
}

function parsePointsAttr(value: string): ReadonlyArray<Vec2> {
  const points: Vec2[] = [];
  let pendingX: number | null = null;
  for (const match of value.matchAll(POINT_NUMBER_RE)) {
    const number = Number(match[0]);
    if (pendingX === null) {
      pendingX = number;
      continue;
    }
    const x = pendingX;
    const y = number;
    points.push({ x, y });
    pendingX = null;
  }
  return points;
}

function polylineToSubs(el: Element, closed: boolean, scale: number): ReadonlyArray<SubPath> {
  const raw = el.getAttribute('points') ?? '';
  const points = parsePointsAttr(raw);
  if (points.length < 2) return [];
  const first = points[0];
  if (first === undefined) return [];
  if (closed) return [{ points: [...points, first], closed: true }];
  // A <polyline> that returns to its start is stored as the <polygon> of its
  // other points (E-2): closed, ending on the first point exactly once.
  if (endsMeet(points, closureToleranceUserUnits(scale))) {
    return [{ points: [...points.slice(0, -1), first], closed: true }];
  }
  return [{ points, closed: false }];
}

function rectToSubs(el: Element, scale: number): ReadonlyArray<SubPath> {
  const x = numAttr(el, 'x');
  const y = numAttr(el, 'y');
  const w = numAttr(el, 'width');
  const h = numAttr(el, 'height');
  if (w <= 0 || h <= 0) return [];
  // SVG 2 corner radii: a missing, unreadable or negative radius is auto and
  // takes the other one; both auto give square corners. Each is then clamped
  // to half its side.
  const rawRx = cornerRadiusAttr(el, 'rx');
  const rawRy = cornerRadiusAttr(el, 'ry');
  const rx = Math.min(w / 2, rawRx ?? rawRy ?? 0);
  const ry = Math.min(h / 2, rawRy ?? rawRx ?? 0);
  if (rx > 0 && ry > 0) return shapePathToSubs(roundedRectPathData(x, y, w, h, rx, ry), scale);
  const points: Vec2[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
    { x, y },
  ];
  return [{ points, closed: true }];
}

function cornerRadiusAttr(el: Element, name: string): number | null {
  const radius = optionalNumAttr(el, name);
  return radius !== null && radius >= 0 ? radius : null;
}

function circleToSubs(el: Element, scale: number): ReadonlyArray<SubPath> {
  const cx = numAttr(el, 'cx');
  const cy = numAttr(el, 'cy');
  const r = numAttr(el, 'r');
  if (r <= 0) return [];
  return shapePathToSubs(ellipsePathData(cx, cy, r, r), scale);
}

function ellipseToSubs(el: Element, scale: number): ReadonlyArray<SubPath> {
  const cx = numAttr(el, 'cx');
  const cy = numAttr(el, 'cy');
  const rx = numAttr(el, 'rx');
  const ry = numAttr(el, 'ry');
  if (rx <= 0 || ry <= 0) return [];
  return shapePathToSubs(ellipsePathData(cx, cy, rx, ry), scale);
}

// A basic shape imports as its SVG 2 "equivalent path", so its elliptical arcs
// stay native curves that job compilation and export keep exact (A-12). Its
// compatibility polyline is flattened at the machine tolerance rather than
// the 0.25 mm path default: tools that still read polylines (offset,
// preflight) had a 0.05 mm polygon for these shapes, and a small circle at
// 0.25 mm would drop to an octagon there. The last arc ends exactly on the
// start, so the path closes without a Z and its zero-length closing edge.
function shapePathToSubs(d: string, scale: number): ReadonlyArray<SubPath> {
  return parsePathD(d, DEFAULT_MACHINE_CURVE_TOLERANCE_MM / positiveScale(scale), scale);
}

// From the rightmost point, an arc to each quarter point in turn.
function ellipsePathData(cx: number, cy: number, rx: number, ry: number): string {
  return [
    `M${pathNumber(cx + rx)} ${pathNumber(cy)}`,
    arcTo(rx, ry, cx, cy + ry),
    arcTo(rx, ry, cx - rx, cy),
    arcTo(rx, ry, cx, cy - ry),
    arcTo(rx, ry, cx + rx, cy),
  ].join(' ');
}

// From (x+rx, y), each edge and then its corner arc, clockwise on screen. An
// edge that clamping shrank to nothing is left out rather than kept as a
// zero-length segment.
function roundedRectPathData(
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
): string {
  const left = x + rx;
  const right = x + w - rx;
  const top = y + ry;
  const bottom = y + h - ry;
  // Exact when clamping set a radius to half its side.
  const hasWidth = 2 * rx < w;
  const hasHeight = 2 * ry < h;
  const commands = [`M${pathNumber(left)} ${pathNumber(y)}`];
  if (hasWidth) commands.push(`H${pathNumber(right)}`);
  commands.push(arcTo(rx, ry, x + w, top));
  if (hasHeight) commands.push(`V${pathNumber(bottom)}`);
  commands.push(arcTo(rx, ry, right, y + h));
  if (hasWidth) commands.push(`H${pathNumber(left)}`);
  commands.push(arcTo(rx, ry, x, bottom));
  if (hasHeight) commands.push(`V${pathNumber(top)}`);
  commands.push(arcTo(rx, ry, left, y));
  return commands.join(' ');
}

// The spec's arcs: unrotated, small (large-arc 0) and sweep-flag 1.
function arcTo(rx: number, ry: number, x: number, y: number): string {
  return `A${pathNumber(rx)} ${pathNumber(ry)} 0 0 1 ${pathNumber(x)} ${pathNumber(y)}`;
}

// String() round-trips every finite double exactly. A sum that overflowed
// refuses the file, as a non-finite <path> coordinate does.
function pathNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('SVG shape contains a non-finite coordinate.');
  return String(value);
}
