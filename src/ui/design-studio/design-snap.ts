// design-snap — where the pointer actually lands (ADR-272, DS-3/DS-4).
//
// Two mechanisms, deliberately ranked: a geometric snap to real geometry ALWAYS
// beats the grid. Dragging a real endpoint off to the nearest grid line is the
// single most damaging thing a snapping system can do in a precision tool, so the
// grid only applies when nothing geometric was in reach.
//
// Screen-pixel reach is converted to millimetres here, so the snap feels the same
// at every zoom while the engine itself stays a pure millimetre function.

import {
  alignOnRay,
  alignToPoints,
  polarTrack,
  resolveSnap,
  type SnapKind,
  type SnapTarget,
} from '../../core/design/snap';
import type { DesignTracking } from './design-tracking';
import type { Sketch } from '../../core/design';
import type { Vec2 } from '../../core/scene';

export type GridSnap = {
  readonly enabled: boolean;
  readonly gridMm: number;
};

// Object-snap reach in screen pixels. LightBurn exposes the same idea as "Object
// Snap Distance", also in pixels, because reach is a property of the hand and the
// screen rather than of the drawing.
export const SNAP_RADIUS_PX = 10;

export type ResolvedSnap = {
  readonly pointMm: Vec2;
  // The geometric target that captured the point, or null when the point came from
  // the grid or was left alone.
  readonly target: SnapTarget | null;
  // The tracking guides that placed the point, when tracking rather than an
  // object snap or the grid did (ADR-272 Amendment 6).
  readonly tracking?: DesignTracking;
};

export type TrackingQuery = {
  readonly enabled: boolean;
  // Polar rays from the gesture start. Off for a rectangle's diagonal or a
  // circle's radius, where a direction means nothing, and while Ortho is on,
  // which is the stricter form of the same constraint.
  readonly polar: boolean;
  readonly polarStepDeg: number;
  readonly toleranceMm: number;
  readonly references: ReadonlyArray<Vec2>;
};

export function snapPointMm(args: {
  readonly sketch: Sketch;
  readonly rawMm: Vec2;
  readonly pxPerMm: number;
  readonly snapEnabled: boolean;
  readonly gridMm: number;
  readonly kinds?: ReadonlySet<SnapKind>;
  readonly excludeEntityId?: string;
  readonly excludeEntityIds?: ReadonlySet<string>;
  // Where the live gesture started: enables tangent / perpendicular snaps and
  // polar tracking.
  readonly fromMm?: Vec2 | null;
  readonly tracking?: TrackingQuery;
}): ResolvedSnap {
  // Snap is the master switch: off leaves the pointer exactly where it is,
  // tracking included (AutoCAD's object tracking likewise needs object snap).
  if (!args.snapEnabled) return { pointMm: args.rawMm, target: null };
  const geometric = objectSnap(args);
  if (geometric !== null) return { pointMm: geometric.atMm, target: geometric };
  // Tracking sits between the two: weaker than a real point, stronger than the grid.
  const tracked =
    args.tracking?.enabled === true
      ? trackPoint(args.rawMm, args.fromMm ?? null, args.tracking)
      : null;
  if (tracked !== null) return tracked;
  return {
    pointMm: snapToGridMm(args.rawMm, { enabled: true, gridMm: args.gridMm }),
    target: null,
  };
}

function objectSnap(args: Parameters<typeof snapPointMm>[0]): SnapTarget | null {
  const toleranceMm = SNAP_RADIUS_PX / (args.pxPerMm > 0 ? args.pxPerMm : 1);
  const geometric = resolveSnap({
    sketch: args.sketch,
    pointMm: args.rawMm,
    toleranceMm,
    ...(args.kinds === undefined ? {} : { kinds: args.kinds }),
    ...(args.excludeEntityId === undefined ? {} : { excludeEntityId: args.excludeEntityId }),
    ...(args.excludeEntityIds === undefined ? {} : { excludeEntityIds: args.excludeEntityIds }),
    ...(args.fromMm == null ? {} : { fromMm: args.fromMm }),
  });
  return geometric?.target ?? null;
}

// A polar ray from the anchor first - and where it crosses an alignment line,
// that crossing - else a plain alignment with the drawing's named points.
function trackPoint(rawMm: Vec2, fromMm: Vec2 | null, query: TrackingQuery): ResolvedSnap | null {
  const { polarStepDeg, references, toleranceMm } = query;
  const polar =
    fromMm === null || !query.polar ? null : polarTrack(fromMm, rawMm, polarStepDeg, toleranceMm);
  if (fromMm !== null && polar?.polarDeg !== undefined) {
    const polarDeg = polar.polarDeg;
    const crossed = alignOnRay({ ...polar, polarDeg }, fromMm, rawMm, references, toleranceMm);
    const placed = crossed ?? polar;
    return { pointMm: placed.atMm, target: null, tracking: { guides: placed.guides, polarDeg } };
  }
  const aligned = alignToPoints(rawMm, references, toleranceMm);
  if (aligned === null) return null;
  return {
    pointMm: aligned.atMm,
    target: null,
    tracking: { guides: aligned.guides, polarDeg: null },
  };
}

export function snapToGridMm(pointMm: Vec2, snap: GridSnap): Vec2 {
  if (!snap.enabled) return pointMm;
  if (!(snap.gridMm > 0) || !Number.isFinite(snap.gridMm)) return pointMm;
  return {
    x: Math.round(pointMm.x / snap.gridMm) * snap.gridMm,
    y: Math.round(pointMm.y / snap.gridMm) * snap.gridMm,
  };
}

// Ortho constrains the moving point to share an axis with the anchor, picking
// whichever axis the pointer has travelled further along. This is the toolbar
// Ortho toggle; Shift is the per-gesture 45-degree constraint in design-draft.
export function applyOrthoMm(anchorMm: Vec2, pointMm: Vec2, enabled: boolean): Vec2 {
  if (!enabled) return pointMm;
  const dx = Math.abs(pointMm.x - anchorMm.x);
  const dy = Math.abs(pointMm.y - anchorMm.y);
  return dx >= dy ? { x: pointMm.x, y: anchorMm.y } : { x: anchorMm.x, y: pointMm.y };
}

// Human-readable name for the status bar, matching the vocabulary LightBurn uses
// for its five snap types.
export function snapKindLabel(kind: SnapKind): string {
  switch (kind) {
    case 'endpoint':
      return 'node';
    case 'midpoint':
      return 'midpoint';
    case 'center':
      return 'centre';
    case 'quadrant':
      return 'quadrant';
    case 'intersection':
      return 'intersection';
    case 'tangent':
      return 'tangent';
    case 'perpendicular':
      return 'perpendicular';
    case 'on-line':
      return 'edge';
  }
}
