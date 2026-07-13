import type { ShapeObject, ShapeSpec } from '../scene';
import { createEllipse } from './create-ellipse';
import { createPolygon } from './create-polygon';
import { createRectangle } from './create-rectangle';
import { createStar } from './create-star';

export type ParametricShapeSpec = Exclude<ShapeSpec, { readonly kind: 'polyline' }>;

const MIN_COUNT = 3;
const MAX_COUNT = 64;
const MIN_INNER_RADIUS_RATIO = 0.05;
const MAX_INNER_RADIUS_RATIO = 0.95;

export function sanitizeParametricShapeSpec(spec: ParametricShapeSpec): ParametricShapeSpec | null {
  switch (spec.kind) {
    case 'rect':
      return sanitizeRectangle(spec);
    case 'ellipse':
      return positiveFinite(spec.widthMm) && positiveFinite(spec.heightMm) ? spec : null;
    case 'polygon':
      return sanitizePolygon(spec);
    case 'star':
      return sanitizeStar(spec);
  }
}

function sanitizeRectangle(
  spec: Extract<ParametricShapeSpec, { readonly kind: 'rect' }>,
): ParametricShapeSpec | null {
  if (!positiveFinite(spec.widthMm) || !positiveFinite(spec.heightMm)) return null;
  if (!nonNegativeFinite(spec.cornerRadiusMm)) return null;
  return {
    ...spec,
    cornerRadiusMm: Math.min(spec.cornerRadiusMm, spec.widthMm / 2, spec.heightMm / 2),
  };
}

function sanitizePolygon(
  spec: Extract<ParametricShapeSpec, { readonly kind: 'polygon' }>,
): ParametricShapeSpec | null {
  if (!positiveFinite(spec.radiusMm) || !Number.isFinite(spec.sides)) return null;
  return { ...spec, sides: clampCount(spec.sides) };
}

function sanitizeStar(
  spec: Extract<ParametricShapeSpec, { readonly kind: 'star' }>,
): ParametricShapeSpec | null {
  if (!positiveFinite(spec.outerRadiusMm)) return null;
  if (!Number.isFinite(spec.points) || !Number.isFinite(spec.innerRadiusRatio)) return null;
  return {
    ...spec,
    points: clampCount(spec.points),
    innerRadiusRatio: Math.min(
      MAX_INNER_RADIUS_RATIO,
      Math.max(MIN_INNER_RADIUS_RATIO, spec.innerRadiusRatio),
    ),
  };
}

export function rematerializeParametricShape(
  object: ShapeObject,
  requested: ParametricShapeSpec,
): ShapeObject | null {
  const spec = sanitizeParametricShapeSpec(requested);
  if (spec === null) return null;
  const generated = createFromSpec(object, spec);
  return {
    ...object,
    spec: generated.spec,
    bounds: generated.bounds,
    paths: generated.paths,
  };
}

function createFromSpec(object: ShapeObject, spec: ParametricShapeSpec): ShapeObject {
  const args = {
    id: object.id,
    color: object.color,
    transform: object.transform,
  };
  switch (spec.kind) {
    case 'rect':
      return createRectangle({ ...args, spec });
    case 'ellipse':
      return createEllipse({ ...args, spec });
    case 'polygon':
      return createPolygon({ ...args, spec });
    case 'star':
      return createStar({ ...args, spec });
  }
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function clampCount(value: number): number {
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(value)));
}
