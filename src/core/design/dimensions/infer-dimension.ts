// infer-dimension — the dimension a pick means (ADR-272 Amendment 7, DS-7).
//
// One Dimension tool, no sub-modes: what was picked decides the kind, as in
// Fusion's and Onshape's unified tool. A line is the only ambiguous pick - it
// may be the first of two lines for an angle - so it waits for a second click:
// another line makes the angle, anything else places the line's length.

import type { Vec2 } from '../../scene';
import type { Sketch, SketchEntity, SketchRectangle } from '../sketch-entity';
import { measureDimension, pathSegment } from './dimension-solve';
import { findSketchEntity, type SketchDimension } from './sketch-dimension';

export type DimensionPick = { readonly entityId: string; readonly atMm: Vec2 };

export type DimensionInference =
  // A line was picked first: wait for a second line (angle) or a placement click (length).
  | { readonly kind: 'pending'; readonly lineId: string }
  | { readonly kind: 'dimension'; readonly dimension: Omit<SketchDimension, 'id'> }
  // Nothing dimensionable: an ellipse, parallel lines, or empty space with nothing pending.
  | { readonly kind: 'none' };

const NONE: DimensionInference = { kind: 'none' };

/**
 * `pick` is the entity under the click (null for empty space); `pendingLineId`
 * the line an earlier click is waiting on. A new dimension is driving at the
 * geometry's current reading, so creating it moves nothing.
 */
export function inferDimension(
  sketch: Sketch,
  pick: DimensionPick | null,
  pendingLineId: string | null,
): DimensionInference {
  const entity = pick === null ? null : findSketchEntity(sketch, pick.entityId);
  if (pendingLineId !== null) {
    if (entity?.kind === 'line' && entity.id !== pendingLineId) {
      return measured(sketch, { kind: 'angle', entityId: pendingLineId, otherEntityId: entity.id });
    }
    return measured(sketch, { kind: 'line-length', entityId: pendingLineId });
  }
  if (entity === null || pick === null) return NONE;
  return inferFromEntity(sketch, entity, pick.atMm);
}

function inferFromEntity(sketch: Sketch, entity: SketchEntity, atMm: Vec2): DimensionInference {
  switch (entity.kind) {
    case 'line':
      return { kind: 'pending', lineId: entity.id };
    case 'path': {
      const segmentIndex = nearestSegment(entity, atMm);
      return segmentIndex === null
        ? NONE
        : measured(sketch, { kind: 'segment-length', entityId: entity.id, segmentIndex });
    }
    case 'rect':
      return measured(sketch, { kind: nearerRectEdge(entity, atMm), entityId: entity.id });
    case 'circle':
      return measured(sketch, { kind: 'diameter', entityId: entity.id });
    case 'arc':
      return measured(sketch, { kind: 'radius', entityId: entity.id });
    case 'ellipse':
      return NONE;
  }
}

function measured(
  sketch: Sketch,
  base: Omit<SketchDimension, 'id' | 'driving' | 'value'>,
): DimensionInference {
  const value = measureDimension(sketch, { ...base, id: 'inferred', driving: false });
  if (value === null) return NONE;
  return { kind: 'dimension', dimension: { ...base, driving: true, value } };
}

// A click on the top or bottom edge means the width (the edge's own length);
// on a side, the height.
function nearerRectEdge(rect: SketchRectangle, atMm: Vec2): 'rect-width' | 'rect-height' {
  const toHorizontal = Math.min(
    Math.abs(atMm.y - rect.origin.y),
    Math.abs(atMm.y - (rect.origin.y + rect.heightMm)),
  );
  const toVertical = Math.min(
    Math.abs(atMm.x - rect.origin.x),
    Math.abs(atMm.x - (rect.origin.x + rect.widthMm)),
  );
  return toHorizontal <= toVertical ? 'rect-width' : 'rect-height';
}

function nearestSegment(path: SketchEntity, atMm: Vec2): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let index = 0; ; index += 1) {
    const segment = pathSegment(path, index);
    if (segment === null) break;
    const gap = distanceToSegment(atMm, segment.from, segment.to);
    if (gap < bestDistance) {
      best = index;
      bestDistance = gap;
    }
  }
  return best;
}

function distanceToSegment(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
        );
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}
