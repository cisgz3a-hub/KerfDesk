// rectangle — pure geometry for the Rectangle drawing primitive (ADR-051,
// Phase G). Produces the rectangle outline as a single closed polyline in local
// shape space: top-left at the origin, +x right, +y down (matching imported
// geometry). The kind:'shape' SceneObject variant places it via bounds +
// transform, so this module owns geometry only — no scene, no color, no I/O.

import type { Polyline, Vec2 } from '../scene';

export type RectangleSpec = {
  readonly widthMm: number;
  readonly heightMm: number;
  // Corner radius in mm. 0 = sharp corners. Clamped to half the shorter side, so
  // a square at radius = side / 2 becomes a stadium / circle rather than
  // self-intersecting.
  readonly cornerRadiusMm: number;
};

// Arc segments per rounded corner. A quarter-turn at 8 segments keeps facets
// under ~12° of arc — smooth at any laser scale and deterministic for snapshots.
const SEGMENTS_PER_CORNER = 8;
const DEG_TO_RAD = Math.PI / 180;

// Outline walked clockwise (y-down) as four quarter-corner arcs; the straight
// edges are the implicit polyline segments between an arc's last point and the
// next arc's first point (and the closing segment). For sharp corners the arcs
// collapse to the four rectangle corners.
export function rectangleToPolylines(spec: RectangleSpec): ReadonlyArray<Polyline> {
  const w = Math.max(0, spec.widthMm);
  const h = Math.max(0, spec.heightMm);
  const r = clampRadius(spec.cornerRadiusMm, w, h);
  if (r <= 0) {
    return [{ points: [pt(0, 0), pt(w, 0), pt(w, h), pt(0, h)], closed: true }];
  }
  const points: Vec2[] = [];
  pushArc(points, w - r, r, r, -90, 0); // top-right
  pushArc(points, w - r, h - r, r, 0, 90); // bottom-right
  pushArc(points, r, h - r, r, 90, 180); // bottom-left
  pushArc(points, r, r, r, 180, 270); // top-left
  return [{ points, closed: true }];
}

function clampRadius(r: number, w: number, h: number): number {
  if (!Number.isFinite(r) || r <= 0) return 0;
  return Math.min(r, Math.min(w, h) / 2);
}

function pushArc(
  out: Vec2[],
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): void {
  for (let i = 0; i <= SEGMENTS_PER_CORNER; i += 1) {
    const deg = startDeg + ((endDeg - startDeg) * i) / SEGMENTS_PER_CORNER;
    const rad = deg * DEG_TO_RAD;
    out.push(pt(cx + r * Math.cos(rad), cy + r * Math.sin(rad)));
  }
}

function pt(x: number, y: number): Vec2 {
  return { x, y };
}
