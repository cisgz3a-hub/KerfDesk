// A rectangle keeps round corners when it is resized (ADR-144 Amendment 1).
//
// A resize sets the object's transform scale. Scaling a rounded rectangle's
// outline by a different factor on each axis stretched its corners into
// ellipses (100 × 50 r10 typed to W 200 burned 20 × 10 mm corners) while the
// Corner radius box showed one number. LightBurn keeps the radius "consistent
// even if the dimensions of the rectangle are later changed", so a rounded
// rectangle whose scale changes takes the new size into its width and height,
// keeps its corner radius at the size it was on the bed, and is left at scale
// 1. A sharp rectangle has no corner to keep: a scale holds its stretch exactly,
// so it is left as it was (registration boxes and jig outlines among them).

import type { SceneObject, ShapeObject, ShapeSpec, Transform } from '../scene';
import { rematerializeParametricShape, type ParametricShapeSpec } from './rematerialize-shape';

type RectangleSpec = Extract<ShapeSpec, { readonly kind: 'rect' }>;
type RectangleObject = ShapeObject & { readonly spec: RectangleSpec };
type AxisScale = { readonly x: number; readonly y: number };

const ROTATION_EPSILON_DEG = 0.000001;
const QUARTER_TURN_DEG = 90;
const FULL_TURN_DEG = 360;
const UNIFORM_RATIO_EPSILON = 1e-12;

/** The object with `transform` applied: what every resize, move and turn
 *  writes. A rounded rectangle whose scale changes is regenerated at its new
 *  size. */
export function withObjectTransform(object: SceneObject, transform: Transform): SceneObject {
  if (!isRoundedRectangle(object) || !resizesRectangle(object.transform, transform)) {
    return { ...object, transform };
  }
  const before = absoluteScale(object.transform);
  const after = absoluteScale(transform);
  const resized = bakeRectangle(object, transform, {
    ...object.spec,
    widthMm: object.spec.widthMm * after.x,
    heightMm: object.spec.heightMm * after.y,
    cornerRadiusMm: object.spec.cornerRadiusMm * Math.min(before.x, before.y),
  });
  return resized ?? { ...object, transform };
}

/** A Shape Properties edit. `spec` is in the object's own units, as the fields
 *  commit it. A rounded rectangle still stretched by its transform (a sharp one
 *  stretched and then given a radius, or one saved before ADR-144 Amendment 1)
 *  is regenerated at its bed size at scale 1, its corner radius at the bed size
 *  the field showed (the smaller axis scale), so the corner it burns is the
 *  round one the field names. */
export function rematerializeShapeSpecEdit(
  object: ShapeObject,
  spec: ParametricShapeSpec,
): ShapeObject | null {
  const scale = absoluteScale(object.transform);
  if (
    spec.kind !== 'rect' ||
    spec.cornerRadiusMm <= 0 ||
    !isFiniteScale(scale) ||
    scale.x === scale.y
  ) {
    return rematerializeParametricShape(object, spec);
  }
  return bakeRectangle(object, object.transform, {
    ...spec,
    widthMm: spec.widthMm * scale.x,
    heightMm: spec.heightMm * scale.y,
    cornerRadiusMm: spec.cornerRadiusMm * Math.min(scale.x, scale.y),
  });
}

function bakeRectangle(
  object: ShapeObject,
  transform: Transform,
  spec: RectangleSpec,
): ShapeObject | null {
  // Mirroring has its own flags; a negative scale keeps its sign at size 1.
  const unscaled: Transform = {
    ...transform,
    scaleX: Math.sign(transform.scaleX),
    scaleY: Math.sign(transform.scaleY),
  };
  return rematerializeParametricShape({ ...object, transform: unscaled }, spec);
}

function isRoundedRectangle(object: SceneObject): object is RectangleObject {
  return object.kind === 'shape' && object.spec.kind === 'rect' && object.spec.cornerRadiusMm > 0;
}

// A move or a turn leaves the size alone. An even resize of a rectangle turned
// at an angle that is not a quarter turn stays a plain scale: its corners stay
// round and grow with it, and the smallest box around it grows by exactly the
// typed factor (ADR-677), which a kept radius would not.
function resizesRectangle(before: Transform, after: Transform): boolean {
  const from = absoluteScale(before);
  const to = absoluteScale(after);
  if (!isFiniteScale(from) || !isFiniteScale(to)) return false;
  if (from.x === to.x && from.y === to.y) return false;
  const even = Math.abs(to.x / from.x - to.y / from.y) <= UNIFORM_RATIO_EPSILON;
  return !even || isSquareToBed(after.rotationDeg);
}

function absoluteScale(transform: Transform): AxisScale {
  return { x: Math.abs(transform.scaleX), y: Math.abs(transform.scaleY) };
}

function isFiniteScale(scale: AxisScale): boolean {
  return Number.isFinite(scale.x) && Number.isFinite(scale.y) && scale.x > 0 && scale.y > 0;
}

function isSquareToBed(rotationDeg: number): boolean {
  if (!Number.isFinite(rotationDeg)) return false;
  const folded = ((rotationDeg % FULL_TURN_DEG) + FULL_TURN_DEG) % QUARTER_TURN_DEG;
  return folded <= ROTATION_EPSILON_DEG || QUARTER_TURN_DEG - folded <= ROTATION_EPSILON_DEG;
}
