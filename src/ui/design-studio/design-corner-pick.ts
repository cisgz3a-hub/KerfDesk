// design-corner-pick — which corner did the operator click (ADR-268, DS-6b).
//
// The corner operations act on ONE corner, so the click has to name it. Two shapes
// answer, and they answer differently:
//
//  - a path names a specific vertex, which fillet/chamfer then replace;
//  - a rectangle names itself, because its corner radius is a single parametric
//    value applied to all four corners. Rounding one corner of a rect would mean
//    giving up its rect-ness, and LightBurn's Radius modifier likewise rounds the
//    whole shape.
//
// Pure and separately testable. Tolerance arrives in millimetres; the caller
// converts from a pixel radius through the current zoom.

import type { Sketch, SketchEntity } from '../../core/design';
import type { Vec2 } from '../../core/scene';

// Click slop for corner picking, in screen pixels. Slightly wider than the
// selection hit radius: a corner is a point rather than a line, so it needs more
// forgiveness to be comfortable.
export const CORNER_PICK_RADIUS_PX = 12;

export type CornerPick =
  | {
      readonly kind: 'path-corner';
      readonly entityId: string;
      readonly cornerIndex: number;
      readonly atMm: Vec2;
    }
  | { readonly kind: 'rect'; readonly entityId: string; readonly atMm: Vec2 };

/**
 * The nearest pickable corner within `toleranceMm`, or null.
 *
 * Topmost-first on ties, since entity order is z-order — the same rule selection
 * uses, so clicking a corner where two shapes overlap picks the one you can see.
 */
export function pickCorner(sketch: Sketch, pointMm: Vec2, toleranceMm: number): CornerPick | null {
  let best: { readonly pick: CornerPick; readonly distanceMm: number } | null = null;
  for (const entity of sketch.entities) {
    for (const candidate of entityCorners(entity)) {
      const distance = Math.hypot(candidate.atMm.x - pointMm.x, candidate.atMm.y - pointMm.y);
      if (distance > toleranceMm) continue;
      // `<=` so a later (higher) entity wins an exact tie.
      if (best === null || distance <= best.distanceMm) {
        best = { pick: candidate, distanceMm: distance };
      }
    }
  }
  return best === null ? null : best.pick;
}

function entityCorners(entity: SketchEntity): ReadonlyArray<CornerPick> {
  switch (entity.kind) {
    case 'path':
      return pathCorners(entity);
    case 'rect':
      return rectCorners(entity);
    // A line has no corner of its own, and a circle or arc has no vertex to round.
    case 'line':
    case 'circle':
    case 'arc':
      return [];
  }
}

function pathCorners(
  entity: Extract<SketchEntity, { readonly kind: 'path' }>,
): ReadonlyArray<CornerPick> {
  const count = entity.points.length;
  if (count < 3) return [];
  const picks: CornerPick[] = [];
  entity.points.forEach((point, index) => {
    // An open path's endpoints are not corners: there is no segment on both sides.
    if (!entity.closed && (index === 0 || index === count - 1)) return;
    picks.push({ kind: 'path-corner', entityId: entity.id, cornerIndex: index, atMm: point });
  });
  return picks;
}

function rectCorners(
  entity: Extract<SketchEntity, { readonly kind: 'rect' }>,
): ReadonlyArray<CornerPick> {
  const { origin, widthMm, heightMm } = entity;
  const right = origin.x + widthMm;
  const bottom = origin.y + heightMm;
  const at: ReadonlyArray<Vec2> = [
    origin,
    { x: right, y: origin.y },
    { x: right, y: bottom },
    { x: origin.x, y: bottom },
  ];
  return at.map((atMm) => ({ kind: 'rect', entityId: entity.id, atMm }));
}
