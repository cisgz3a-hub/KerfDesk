// Circular-arc bulges for curved DXF edges (ADR-452).
//
// A run of consecutive cubics and elliptical arcs is fitted with lines and
// circular arcs by the shared arc fitter (core/geometry/arc-fit, ADR-432)
// with its exact-arc budget: a CAD file draws an arc exactly, so no controller
// chord sag is deducted, and the fit stays within the stated tolerance of the
// canonical curve both ways, less the fitter's source sampling (0.001 mm) and
// rounding (0.002 mm) reserves; the rounding reserve covers the default
// 0.001 mm DXF coordinate grid. Every corner inside the run is kept at its
// exact position and the run ends exactly where its last segment ends. Arcs
// sweep at most 179 degrees (ARC_FIT_MAX_SWEEP_RAD), so every fitted bulge
// lies inside (-1, 1). An ellipse is never written as one circle: its arcs
// are fitted like any other curve, which also covers circles distorted by a
// non-uniform scale.
//
// A circular arc that is part of the canonical curve keeps its exact bulge;
// one sweeping more than a half turn is split into equal parts so no bulge
// exceeds 1 in magnitude (a half circle).
//
// Input is the app's Y-down frame; bulges are signed for the Y-up frame the
// writer produces by mirroring Y (positive = counter-clockwise there).
//
// Pure-core compliant: no clock, no random, no I/O, no DOM.

import { arcSweep, fitArcMoves, type ArcFitPlacement } from '../geometry/arc-fit';
import type { PathSegment, Vec2 } from '../scene/scene-object';

/** One polyline edge: the vertex it ends at and the bulge from the vertex before. */
export type BulgeEdge = { readonly to: Vec2; readonly bulge: number };

const IDENTITY_PLACEMENT: ArcFitPlacement = { map: (point) => point, largestScale: 1 };
/** Largest included angle one bulge carries: a half circle, bulge magnitude 1. */
const MAX_BULGE_SWEEP_RAD = Math.PI;

/** Fitted edges for a run of curved segments starting at `from`. */
export function fittedCurveEdges(
  from: Vec2,
  segments: ReadonlyArray<PathSegment>,
  toleranceMm: number,
): BulgeEdge[] {
  const moves = fitArcMoves(
    { start: from, segments, closed: false },
    IDENTITY_PLACEMENT,
    toleranceMm,
    {
      exactArcs: true,
    },
  );
  const edges: BulgeEdge[] = [];
  let current = from;
  for (const move of moves) {
    if (move.kind === 'line') edges.push({ to: move.to, bulge: 0 });
    else {
      const sweep = arcSweep(current, move.to, move.center, move.clockwise);
      // Clockwise in the Y-down frame is counter-clockwise once Y is mirrored.
      edges.push({ to: move.to, bulge: (move.clockwise ? 1 : -1) * Math.tan(sweep / 4) });
    }
    current = move.to;
  }
  return edges;
}

/**
 * The exact edges of a circular arc from `from` to `to` with bulge `bulge`
 * (Y-up sign), split into equal parts of at most a half circle each.
 */
export function splitCircularBulge(from: Vec2, to: Vec2, bulge: number): BulgeEdge[] {
  const included = 4 * Math.atan(Math.abs(bulge));
  const parts = Math.max(1, Math.ceil(included / MAX_BULGE_SWEEP_RAD - 1e-12));
  if (parts === 1) return [{ to, bulge }];
  const partBulge = Math.sign(bulge) * Math.tan(included / (4 * parts));
  const edges: BulgeEdge[] = [];
  for (let part = 1; part <= parts; part += 1) {
    const next = part === parts ? to : pointAlongBulge(from, to, bulge, part / parts);
    edges.push({ to: next, bulge: partBulge });
  }
  return edges;
}

// The point a fraction `t` of the way along the arc. The centre sits on the
// chord's perpendicular bisector; in the Y-down frame a positive (Y-up
// counter-clockwise) bulge puts the arc's middle at mid + (b / 2) (-dy, dx).
function pointAlongBulge(from: Vec2, to: Vec2, bulge: number, t: number): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const halfChord = Math.hypot(dx, dy) / 2;
  const included = 4 * Math.atan(Math.abs(bulge));
  const radius = halfChord / Math.sin(included / 2);
  // Signed distance from the chord midpoint to the centre along (-dy, dx)/|d|,
  // on the side opposite the arc's middle for a minor arc.
  const middleSide = Math.sign(bulge);
  const centerOffset = -middleSide * radius * Math.cos(included / 2);
  const length = 2 * halfChord;
  const nx = -dy / length;
  const ny = dx / length;
  const center = {
    x: (from.x + to.x) / 2 + centerOffset * nx,
    y: (from.y + to.y) / 2 + centerOffset * ny,
  };
  const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
  // Y-up counter-clockwise is decreasing angle in the Y-down frame.
  const angle = startAngle - middleSide * included * t;
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
}
