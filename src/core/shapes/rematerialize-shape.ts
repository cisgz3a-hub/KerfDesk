import type { ShapeObject, ShapeSpec } from '../scene';
import { createEllipse } from './primitives/create-ellipse';
import { createPolygon } from './primitives/create-polygon';
import { createRectangle } from './primitives/create-rectangle';
import { createStar } from './primitives/create-star';
import { clampBulge } from './primitives/bulge-outline';
import { clampAlternateRatio } from './primitives/star';
import { isFinitePositive } from '../util/finite';

// Barcodes re-encode their data rather than resize by field, so they are not
// parametric in this sense (ADR-386).
export type ParametricShapeSpec = Exclude<
  ShapeSpec,
  { readonly kind: 'polyline' } | { readonly kind: 'barcode' }
>;

const MIN_COUNT = 3;
const MAX_COUNT = 64;
const MIN_INNER_RADIUS_RATIO = 0.05;
const MAX_INNER_RADIUS_RATIO = 0.95;

export function sanitizeParametricShapeSpec(spec: ParametricShapeSpec): ParametricShapeSpec | null {
  switch (spec.kind) {
    case 'rect':
      return sanitizeRectangle(spec);
    case 'ellipse':
      return isFinitePositive(spec.widthMm) && isFinitePositive(spec.heightMm) ? spec : null;
    case 'polygon':
      return sanitizePolygon(spec);
    case 'star':
      return sanitizeStar(spec);
  }
}

function sanitizeRectangle(
  spec: Extract<ParametricShapeSpec, { readonly kind: 'rect' }>,
): ParametricShapeSpec | null {
  if (!isFinitePositive(spec.widthMm) || !isFinitePositive(spec.heightMm)) return null;
  if (!nonNegativeFinite(spec.cornerRadiusMm)) return null;
  // The authored radius is kept: the outline clamps it to half the shorter
  // side, so narrowing a rectangle and widening it again brings the corner
  // back (ADR-144 Amendment 1).
  return spec;
}

function sanitizePolygon(
  spec: Extract<ParametricShapeSpec, { readonly kind: 'polygon' }>,
): ParametricShapeSpec | null {
  if (!isFinitePositive(spec.radiusMm) || !Number.isFinite(spec.sides)) return null;
  return {
    ...spec,
    sides: clampCount(spec.sides),
    ...(spec.bulge === undefined ? {} : { bulge: clampBulge(spec.bulge) }),
  };
}

function sanitizeStar(
  spec: Extract<ParametricShapeSpec, { readonly kind: 'star' }>,
): ParametricShapeSpec | null {
  if (!isFinitePositive(spec.outerRadiusMm)) return null;
  if (!Number.isFinite(spec.points) || !Number.isFinite(spec.innerRadiusRatio)) return null;
  return {
    ...spec,
    points: clampCount(spec.points),
    innerRadiusRatio: Math.min(
      MAX_INNER_RADIUS_RATIO,
      Math.max(MIN_INNER_RADIUS_RATIO, spec.innerRadiusRatio),
    ),
    ...(spec.bulge === undefined ? {} : { bulge: clampBulge(spec.bulge) }),
    ...(spec.alternateRadiusRatio === undefined
      ? {}
      : { alternateRadiusRatio: clampAlternateRatio(spec.alternateRadiusRatio) }),
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

function nonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function clampCount(value: number): number {
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(value)));
}
