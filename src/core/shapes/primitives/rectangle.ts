// rectangle — pure geometry for the Rectangle drawing primitive (ADR-051,
// Phase G). Produces the rectangle outline as a single closed polyline in local
// shape space: top-left at the origin, +x right, +y down (matching imported
// geometry). The kind:'shape' SceneObject variant places it via bounds +
// transform, so this module owns geometry only — no scene, no color, no I/O.

import { parametricEllipseCurve } from '../../geometry';
import { polylineToCurveSubpath, type CurveSubpath, type Polyline, type Vec2 } from '../../scene';

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
    // The final point repeats the first so the line renderer draws the closing
    // edge — it strokes points as-is and never calls closePath (see
    // io/svg/shape-to-polylines, which builds every closed shape the same way).
    return [{ points: [pt(0, 0), pt(w, 0), pt(w, h), pt(0, h), pt(0, 0)], closed: true }];
  }
  const points: Vec2[] = [];
  pushArc(points, w - r, r, r, -90, 0); // top-right
  pushArc(points, w - r, h - r, r, 0, 90); // bottom-right
  pushArc(points, r, h - r, r, 90, 180); // bottom-left
  pushArc(points, r, r, r, 180, 270); // top-left
  closeLoop(points);
  return [{ points, closed: true }];
}

export function rectangleToCurve(spec: RectangleSpec): CurveSubpath {
  const w = Math.max(0, spec.widthMm);
  const h = Math.max(0, spec.heightMm);
  const r = clampRadius(spec.cornerRadiusMm, w, h);
  if (r <= 0) {
    return polylineToCurveSubpath(rectangleToPolylines(spec)[0] as Polyline);
  }
  const corners = [
    { center: pt(w - r, r), startParam: -Math.PI / 2 },
    { center: pt(w - r, h - r), startParam: 0 },
    { center: pt(r, h - r), startParam: Math.PI / 2 },
    { center: pt(r, r), startParam: Math.PI },
  ];
  const start = pt(w - r, 0);
  const segments: CurveSubpath['segments'][number][] = [];
  let cursor = start;
  for (const corner of corners) {
    const arc = parametricEllipseCurve({
      center: corner.center,
      majorAxis: { x: r, y: 0 },
      ratio: 1,
      startParam: corner.startParam,
      sweep: Math.PI / 2,
      closed: false,
    });
    if (!samePoint(cursor, arc.start)) segments.push({ kind: 'line', to: arc.start });
    segments.push(...arc.segments);
    cursor = arc.segments.at(-1)?.to ?? arc.start;
  }
  if (!samePoint(cursor, start)) segments.push({ kind: 'line', to: start });
  return { start, segments, closed: true };
}

// Repeat the first point so the polyline visually closes — the codebase
// convention for closed shapes (the stroke renderer does not closePath).
function closeLoop(points: Vec2[]): void {
  const first = points[0];
  if (first !== undefined) points.push(first);
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

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}
