// design-snap — grid snapping for the Design Studio (ADR-268, DS-3).
//
// DS-3 scope is the grid only. The full object-snap engine — endpoint, midpoint,
// centre, quadrant, intersection, tangent, perpendicular, which LightBurn names
// as five distinct snap types each with its own cursor glyph — is DS-4 and lands
// as a pure module under core/design/snap/. This file is the seam it will replace,
// kept deliberately small so that swap is clean.

import type { Vec2 } from '../../core/scene';

export type GridSnap = {
  readonly enabled: boolean;
  readonly gridMm: number;
};

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
