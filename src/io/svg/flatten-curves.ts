// flatten-curves — De Casteljau subdivision of cubic and quadratic Bezier
// curves into polylines, plus W3C-spec arc-to-cubic conversion for elliptical
// arcs. Replaces parse-path-d's Phase A lossy "use the endpoint" treatment
// of C/c, S/s, Q/q, T/t, A/a commands.
//
// Tolerance: max distance from curve to straight chord. Smaller → more
// segments, smoother curve. Default 0.25 mm matches LightBurn's "smooth"
// import preset on a typical bed.

import type { Vec2 } from '../../core/scene';

export const DEFAULT_FLATNESS_MM = 0.25;

// --- Cubic Bezier ---

export function flattenCubic(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  tolerance: number,
  out: Vec2[],
): void {
  if (isFlatEnoughCubic(p0, p1, p2, p3, tolerance)) {
    out.push(p3);
    return;
  }
  const p01 = mid(p0, p1);
  const p12 = mid(p1, p2);
  const p23 = mid(p2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const p0123 = mid(p012, p123);
  flattenCubic(p0, p01, p012, p0123, tolerance, out);
  flattenCubic(p0123, p123, p23, p3, tolerance, out);
}

function isFlatEnoughCubic(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, tolerance: number): boolean {
  // Distance from each control point to the chord p0→p3.
  const d1 = perpDistance(p0, p3, p1);
  const d2 = perpDistance(p0, p3, p2);
  return Math.max(d1, d2) <= tolerance;
}

// --- Quadratic Bezier (converted to cubic for unified subdivision) ---

export function flattenQuadratic(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  tolerance: number,
  out: Vec2[],
): void {
  // Quadratic → cubic: c1 = p0 + 2/3 (p1 - p0); c2 = p2 + 2/3 (p1 - p2).
  const c1: Vec2 = {
    x: p0.x + (2 / 3) * (p1.x - p0.x),
    y: p0.y + (2 / 3) * (p1.y - p0.y),
  };
  const c2: Vec2 = {
    x: p2.x + (2 / 3) * (p1.x - p2.x),
    y: p2.y + (2 / 3) * (p1.y - p2.y),
  };
  flattenCubic(p0, c1, c2, p2, tolerance, out);
}

// --- Elliptical arc (W3C SVG 1.1 §F.6.5 implementation notes) ---

export type ArcParams = {
  readonly rx: number;
  readonly ry: number;
  readonly xAxisRotationDeg: number;
  readonly largeArc: boolean;
  readonly sweep: boolean;
};

export function flattenArc(
  start: Vec2,
  end: Vec2,
  arc: ArcParams,
  tolerance: number,
  out: Vec2[],
): void {
  const rx0 = Math.abs(arc.rx);
  const ry0 = Math.abs(arc.ry);
  if (rx0 === 0 || ry0 === 0) {
    out.push(end);
    return;
  }
  // Convert to center parameterization then to a sequence of cubic Beziers
  // (≤ 4 per arc, one per quarter-turn).
  const cubics = arcToCubics(start, end, rx0, ry0, arc);
  for (const c of cubics) {
    flattenCubic(c.p0, c.p1, c.p2, c.p3, tolerance, out);
  }
}

export type Cubic = {
  readonly p0: Vec2;
  readonly p1: Vec2;
  readonly p2: Vec2;
  readonly p3: Vec2;
};

export function arcToCubics(
  start: Vec2,
  end: Vec2,
  rxIn: number,
  ryIn: number,
  arc: ArcParams,
): ReadonlyArray<Cubic> {
  const phi = (arc.xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // Step 1: compute (x1', y1') — endpoint in the rotated coord system.
  const dx = (start.x - end.x) / 2;
  const dy = (start.y - end.y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // Step 2: ensure radii are large enough (spec correction).
  let rx = rxIn;
  let ry = ryIn;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  // Step 3: compute (cx', cy').
  const rxSq = rx * rx;
  const rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;
  const sign = arc.largeArc === arc.sweep ? -1 : 1;
  const numerator = Math.max(0, rxSq * rySq - rxSq * y1pSq - rySq * x1pSq);
  const denominator = rxSq * y1pSq + rySq * x1pSq;
  const coef = sign * Math.sqrt(numerator / denominator);
  const cxp = (coef * (rx * y1p)) / ry;
  const cyp = (coef * -(ry * x1p)) / rx;

  // Step 4: back-rotate to scene coords.
  const cx = cosPhi * cxp - sinPhi * cyp + (start.x + end.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (start.y + end.y) / 2;

  // Step 5: compute start angle and sweep delta.
  const theta1 = angleBetween(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let deltaTheta = angleBetween(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!arc.sweep && deltaTheta > 0) deltaTheta -= 2 * Math.PI;
  else if (arc.sweep && deltaTheta < 0) deltaTheta += 2 * Math.PI;

  // Step 6: split into ≤ π/2 segments and emit a cubic per segment.
  const segCount = Math.max(1, Math.ceil(Math.abs(deltaTheta) / (Math.PI / 2)));
  const segDelta = deltaTheta / segCount;
  const cubics: Cubic[] = [];
  for (let i = 0; i < segCount; i += 1) {
    const t0 = theta1 + i * segDelta;
    const t1 = t0 + segDelta;
    cubics.push(arcSegmentToCubic(cx, cy, rx, ry, cosPhi, sinPhi, t0, t1));
  }
  return cubics;
}

function arcSegmentToCubic(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  cosPhi: number,
  sinPhi: number,
  t0: number,
  t1: number,
): Cubic {
  const cosT0 = Math.cos(t0);
  const sinT0 = Math.sin(t0);
  const cosT1 = Math.cos(t1);
  const sinT1 = Math.sin(t1);
  const alpha = (Math.sin(t1 - t0) * (Math.sqrt(4 + 3 * Math.tan((t1 - t0) / 2) ** 2) - 1)) / 3;
  const p0e: Vec2 = { x: rx * cosT0, y: ry * sinT0 };
  const p3e: Vec2 = { x: rx * cosT1, y: ry * sinT1 };
  const p1e: Vec2 = { x: p0e.x - alpha * rx * sinT0, y: p0e.y + alpha * ry * cosT0 };
  const p2e: Vec2 = { x: p3e.x + alpha * rx * sinT1, y: p3e.y - alpha * ry * cosT1 };
  return {
    p0: rotateAndTranslate(p0e, cosPhi, sinPhi, cx, cy),
    p1: rotateAndTranslate(p1e, cosPhi, sinPhi, cx, cy),
    p2: rotateAndTranslate(p2e, cosPhi, sinPhi, cx, cy),
    p3: rotateAndTranslate(p3e, cosPhi, sinPhi, cx, cy),
  };
}

function rotateAndTranslate(p: Vec2, cosPhi: number, sinPhi: number, cx: number, cy: number): Vec2 {
  return {
    x: cosPhi * p.x - sinPhi * p.y + cx,
    y: sinPhi * p.x + cosPhi * p.y + cy,
  };
}

function angleBetween(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy;
  const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  const cos = Math.max(-1, Math.min(1, dot / len));
  const sign = ux * vy - uy * vx < 0 ? -1 : 1;
  return sign * Math.acos(cos);
}

// --- shared math ---

function mid(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function perpDistance(a: Vec2, b: Vec2, p: Vec2): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
}
