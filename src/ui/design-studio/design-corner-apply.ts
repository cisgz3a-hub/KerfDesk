// design-corner-apply — turn a corner pick into a sketch edit (ADR-271, DS-6b).
//
// The bridge between "the operator clicked here with the fillet tool" and the pure
// corner operations. Two shapes are handled differently on purpose:
//
//  - a path corner goes through filletPathCorner / chamferPathCorner;
//  - a rectangle's fillet sets its parametric cornerRadiusMm, keeping the shape a
//    rectangle. Chamfering a rectangle has no parametric form, so the rect is
//    converted to an explicit closed path first and then chamfered — the operator
//    asked for a chamfered box, and the only honest way to give them one is to stop
//    pretending it is still a plain rect.
//
// Returns null when nothing applies, which the caller reports and never treats as
// an error (rule 7).

import {
  entityToPolylines,
  findEntity,
  replaceEntity,
  type Sketch,
  type SketchEntity,
  type SketchPath,
} from '../../core/design';
import { chamferPathCorner, filletPathCorner } from '../../core/design/ops';
import type { CornerPick } from './design-corner-pick';

export type CornerOp = 'fillet' | 'chamfer';

export function applyCornerOp(
  sketch: Sketch,
  pick: CornerPick,
  op: CornerOp,
  sizeMm: number,
): Sketch | null {
  const entity = findEntity(sketch, pick.entityId);
  if (entity === null) return null;
  if (pick.kind === 'rect') return applyToRect(sketch, entity, op, sizeMm);
  if (entity.kind !== 'path') return null;
  const edited =
    op === 'fillet'
      ? (filletPathCorner(entity, pick.cornerIndex, sizeMm)?.path ?? null)
      : chamferPathCorner(entity, pick.cornerIndex, sizeMm);
  return edited === null ? null : replaceEntity(sketch, edited);
}

function applyToRect(
  sketch: Sketch,
  entity: SketchEntity,
  op: CornerOp,
  sizeMm: number,
): Sketch | null {
  if (entity.kind !== 'rect') return null;
  if (op === 'fillet') {
    // Parametric and reversible: the rect stays a rect and its radius stays
    // typeable in the inspector.
    const limit = Math.min(entity.widthMm, entity.heightMm) / 2;
    if (sizeMm > limit) return null;
    return replaceEntity(sketch, { ...entity, cornerRadiusMm: sizeMm });
  }
  return chamferAllRectCorners(sketch, entity, sizeMm);
}

// Chamfers all four corners at once, matching the fillet semantics for a rect, by
// converting to an explicit closed path and walking the corners. Working backwards
// keeps the earlier indices valid as each chamfer inserts a point.
function chamferAllRectCorners(
  sketch: Sketch,
  entity: Extract<SketchEntity, { readonly kind: 'rect' }>,
  sizeMm: number,
): Sketch | null {
  const outline = rectAsPath(entity);
  if (outline === null) return null;
  let path: SketchPath = outline;
  for (let corner = outline.points.length - 1; corner >= 0; corner -= 1) {
    const next = chamferPathCorner(path, corner, sizeMm);
    if (next === null) return null;
    path = next;
  }
  return replaceEntity(sketch, path);
}

// Only a SHARP rectangle converts cleanly: a rounded one has already replaced its
// corners with arc chords, and chamfering those would cut the arc rather than the
// corner. Round or chamfer, not both.
function rectAsPath(entity: Extract<SketchEntity, { readonly kind: 'rect' }>): SketchPath | null {
  if (entity.cornerRadiusMm > 0) return null;
  const [polyline] = entityToPolylines(entity);
  if (polyline === undefined || polyline.points.length < 4) return null;
  // The rectangle outline repeats its seam vertex so a line renderer draws the
  // closing edge. A SketchPath carries closure in its flag instead, so the repeat
  // has to go — left in, it reads as a doubled vertex and the corner operation
  // rightly refuses it.
  const points = withoutClosingRepeat(polyline.points);
  if (points.length < 4) return null;
  return {
    kind: 'path',
    id: entity.id,
    points,
    closed: true,
    ...(entity.construction === true ? { construction: true } : {}),
  };
}

const CLOSURE_EPSILON_MM = 1e-9;

function withoutClosingRepeat(
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return points;
  const repeats =
    Math.abs(first.x - last.x) < CLOSURE_EPSILON_MM &&
    Math.abs(first.y - last.y) < CLOSURE_EPSILON_MM;
  return repeats ? points.slice(0, -1) : points;
}
