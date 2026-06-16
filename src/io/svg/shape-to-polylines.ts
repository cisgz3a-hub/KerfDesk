// shape-to-polylines — converts a single SVG primitive element (rect, line,
// polyline, polygon, circle, ellipse, path) into a list of subpaths in
// object-local coordinates. Color/stroke attribution is handled by the caller
// in parse-svg.ts.
//
// Phase A scope: the seven primitive elements above. Curves inside <path d>
// are flattened via parsePathD's Phase-A lossy approach (endpoint-only). The
// SVG spec also defines <use>, <g>, <symbol>, gradients, masks, clip-paths,
// patterns — these are walked transparently in parse-svg.ts where applicable.

import type { Vec2 } from '../../core/scene';
import { ellipseSegmentCount } from '../../core/shapes';
import { parsePathD, type SubPath } from './parse-path-d';

const RECT_CORNER_SEGMENTS = 8;

export function elementToSubPaths(el: Element): ReadonlyArray<SubPath> {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'path':
      return pathToSubs(el);
    case 'line':
      return lineToSubs(el);
    case 'polyline':
      return polylineToSubs(el, false);
    case 'polygon':
      return polylineToSubs(el, true);
    case 'rect':
      return rectToSubs(el);
    case 'circle':
      return circleToSubs(el);
    case 'ellipse':
      return ellipseToSubs(el);
    default:
      return [];
  }
}

function numAttr(el: Element, name: string, fallback = 0): number {
  const raw = el.getAttribute(name);
  if (raw === null) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumAttr(el: Element, name: string): number | null {
  const raw = el.getAttribute(name);
  if (raw === null) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function pathToSubs(el: Element): ReadonlyArray<SubPath> {
  const d = el.getAttribute('d');
  if (d === null || d.trim() === '') return [];
  return parsePathD(d);
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
  const nums = (value.match(/[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
  const points: Vec2[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i];
    const y = nums[i + 1];
    if (x === undefined || y === undefined) continue;
    points.push({ x, y });
  }
  return points;
}

function polylineToSubs(el: Element, closed: boolean): ReadonlyArray<SubPath> {
  const raw = el.getAttribute('points') ?? '';
  const points = parsePointsAttr(raw);
  if (points.length < 2) return [];
  if (closed && points.length >= 2) {
    const first = points[0];
    if (first === undefined) return [];
    return [{ points: [...points, first], closed: true }];
  }
  return [{ points, closed: false }];
}

function rectToSubs(el: Element): ReadonlyArray<SubPath> {
  const x = numAttr(el, 'x');
  const y = numAttr(el, 'y');
  const w = numAttr(el, 'width');
  const h = numAttr(el, 'height');
  if (w <= 0 || h <= 0) return [];
  const rawRx = optionalNumAttr(el, 'rx');
  const rawRy = optionalNumAttr(el, 'ry');
  const rx = Math.min(w / 2, Math.max(0, rawRx ?? rawRy ?? 0));
  const ry = Math.min(h / 2, Math.max(0, rawRy ?? rawRx ?? 0));
  if (rx > 0 && ry > 0) return [roundedRect(x, y, w, h, rx, ry)];
  const points: Vec2[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
    { x, y },
  ];
  return [{ points, closed: true }];
}

function roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number): SubPath {
  const points: Vec2[] = [{ x: x + rx, y }];
  addCorner(points, x + w - rx, y + ry, rx, ry, -90, 0);
  addCorner(points, x + w - rx, y + h - ry, rx, ry, 0, 90);
  addCorner(points, x + rx, y + h - ry, rx, ry, 90, 180);
  addCorner(points, x + rx, y + ry, rx, ry, 180, 270);
  points.push(points[0] ?? { x: x + rx, y });
  return { points, closed: true };
}

function addCorner(
  points: Vec2[],
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startDeg: number,
  endDeg: number,
): void {
  for (let i = 0; i <= RECT_CORNER_SEGMENTS; i += 1) {
    const t = i / RECT_CORNER_SEGMENTS;
    const deg = startDeg + (endDeg - startDeg) * t;
    const rad = (deg / 180) * Math.PI;
    const p = { x: cx + rx * Math.cos(rad), y: cy + ry * Math.sin(rad) };
    const prev = points[points.length - 1];
    if (prev !== undefined && closePoint(prev, p)) continue;
    points.push(p);
  }
}

function closePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

function arcPolygon(cx: number, cy: number, rx: number, ry: number): SubPath {
  const segments = ellipseSegmentCount(Math.max(Math.abs(rx), Math.abs(ry)));
  const points: Vec2[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    points.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return { points, closed: true };
}

function circleToSubs(el: Element): ReadonlyArray<SubPath> {
  const cx = numAttr(el, 'cx');
  const cy = numAttr(el, 'cy');
  const r = numAttr(el, 'r');
  if (r <= 0) return [];
  return [arcPolygon(cx, cy, r, r)];
}

function ellipseToSubs(el: Element): ReadonlyArray<SubPath> {
  const cx = numAttr(el, 'cx');
  const cy = numAttr(el, 'cy');
  const rx = numAttr(el, 'rx');
  const ry = numAttr(el, 'ry');
  if (rx <= 0 || ry <= 0) return [];
  return [arcPolygon(cx, cy, rx, ry)];
}
