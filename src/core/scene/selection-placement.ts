// Whole-selection placement commands (LightBurn gap batch 3, ADR-410):
// Rotate 90° about the selection centre, and Move Selected Objects to the
// bed centre, a corner or an edge. Both treat the selection as one rigid body,
// so grouped and multi-object selections keep their relative layout.

import { combinedBBox, type AABB } from './hit-test';
import type { SceneObject, Vec2 } from './scene-object';
import {
  selectionAnchorPoint,
  type SelectionAnchor,
  type SelectionTransformResult,
} from './selection-transform';

/** +1 turns clockwise on screen (scene +Y points down), -1 counter-clockwise. */
export type QuarterTurnDirection = 1 | -1;

export type BedSize = { readonly width: number; readonly height: number };

const QUARTER_TURN_DEG = 90;
const FULL_TURN_DEG = 360;

/**
 * Rotates every object a quarter turn about the centre of the selection's
 * combined bounding box. The pivot rotation is exact (no trigonometry), so
 * four turns return the artwork to exactly where it started.
 */
export function buildSelectionQuarterTurnEdit(
  objects: ReadonlyArray<SceneObject>,
  direction: QuarterTurnDirection,
): SelectionTransformResult {
  const bbox = combinedBBox(objects);
  if (bbox === null) return { kind: 'error', reason: 'empty-selection' };
  const pivot = selectionAnchorPoint(bbox, 'c');
  return {
    kind: 'ok',
    transforms: objects.map((object) => {
      const origin = quarterTurnPoint(object.transform, pivot, direction);
      return {
        id: object.id,
        transform: {
          ...object.transform,
          x: origin.x,
          y: origin.y,
          rotationDeg: normalizeDeg(object.transform.rotationDeg + direction * QUARTER_TURN_DEG),
        },
      };
    }),
  };
}

/**
 * Moves the selection so its anchor point lands on the same anchor of the bed:
 * 'c' centres it, a corner puts the selection's corner in the bed's corner, and
 * an edge ('n', 'e', 's', 'w') puts it against that edge, centred along it.
 */
export function buildSelectionMoveToBedEdit(
  objects: ReadonlyArray<SceneObject>,
  bed: BedSize,
  anchor: SelectionAnchor,
): SelectionTransformResult {
  if (!isPositiveFinite(bed.width) || !isPositiveFinite(bed.height)) {
    return { kind: 'error', reason: 'invalid-dimension' };
  }
  const bbox = combinedBBox(objects);
  if (bbox === null) return { kind: 'error', reason: 'empty-selection' };
  const bedBox: AABB = { minX: 0, minY: 0, maxX: bed.width, maxY: bed.height };
  const from = selectionAnchorPoint(bbox, anchor);
  const to = selectionAnchorPoint(bedBox, anchor);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return {
    kind: 'ok',
    transforms: objects.map((object) => ({
      id: object.id,
      transform: { ...object.transform, x: object.transform.x + dx, y: object.transform.y + dy },
    })),
  };
}

function quarterTurnPoint(point: Vec2, pivot: Vec2, direction: QuarterTurnDirection): Vec2 {
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  // Clockwise in a +Y-down frame maps (dx, dy) to (-dy, dx).
  return direction === 1
    ? { x: pivot.x - dy, y: pivot.y + dx }
    : { x: pivot.x + dy, y: pivot.y - dx };
}

function normalizeDeg(deg: number): number {
  const normalized = deg % FULL_TURN_DEG;
  return normalized < 0 ? normalized + FULL_TURN_DEG : normalized;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
