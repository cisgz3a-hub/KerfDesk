// stretch-entities — resize one axis at a time about a fixed anchor (ADR-272
// Amendment 4). The write half of the edge grips.
//
// Separate from scaleEntities because the two have different EXACTNESS rules,
// and hiding that difference behind one function is how a precision tool starts
// lying. A uniform scale is exact for every entity kind. A per-axis stretch is
// not, so each kind is handled by what it can honestly represent:
//
//   rect (square corners) — exact.
//   line, path            — exact; points move independently on each axis.
//   circle                — becomes an ELLIPSE. Exact, and the reason the
//                           ellipse arm exists at all.
//   ellipse               — stays an ellipse. Exact: an axis-aligned stretch of
//                           an axis-aligned ellipse is another one.
//   rect (rounded)        — the corner radius follows the SMALLER factor. A true
//                           stretch makes the corners elliptical, which
//                           RectangleSpec cannot hold; the smaller factor keeps
//                           the fillet inside the shorter side, and matches the
//                           uniform case exactly when the factors are equal.
//   arc                   — BAKED to a path at the sampled tolerance. A
//                           stretched arc is an elliptical arc, which neither
//                           this model nor G2/G3 can express, so the sampled
//                           polyline is the honest form rather than an arc of a
//                           radius the operator never asked for.
//
// A stretch with equal factors is a uniform scale and delegates to scaleEntity,
// so a drag that happens to be square never bakes an arc.

import type { Vec2 } from '../../scene';
import { entityToPolylines } from '../entity-geometry';
import { entityBase, type Sketch, type SketchEntity } from '../sketch-entity';
import { MIN_SCALE_FACTOR, scaleEntity } from './scale-entities';

/** Independent factors per axis. Equal factors mean a uniform scale. */
export type StretchFactors = {
  readonly x: number;
  readonly y: number;
};

export function stretchEntity(
  entity: SketchEntity,
  anchorMm: Vec2,
  factors: StretchFactors,
): SketchEntity {
  if (factors.x === factors.y) return scaleEntity(entity, anchorMm, factors.x);
  const about = (point: Vec2): Vec2 => ({
    x: anchorMm.x + (point.x - anchorMm.x) * factors.x,
    y: anchorMm.y + (point.y - anchorMm.y) * factors.y,
  });
  const smaller = Math.min(factors.x, factors.y);
  switch (entity.kind) {
    case 'rect':
      return {
        ...entity,
        origin: about(entity.origin),
        widthMm: entity.widthMm * factors.x,
        heightMm: entity.heightMm * factors.y,
        cornerRadiusMm: entity.cornerRadiusMm * smaller,
      };
    case 'circle':
      return {
        ...entityBase(entity),
        kind: 'ellipse',
        center: about(entity.center),
        radiusXMm: entity.radiusMm * factors.x,
        radiusYMm: entity.radiusMm * factors.y,
      };
    case 'ellipse':
      return {
        ...entity,
        center: about(entity.center),
        radiusXMm: entity.radiusXMm * factors.x,
        radiusYMm: entity.radiusYMm * factors.y,
      };
    case 'arc':
      return bakedArc(entity, about);
    case 'line':
      return { ...entity, start: about(entity.start), end: about(entity.end) };
    case 'path':
      return { ...entity, points: entity.points.map(about) };
  }
}

/**
 * Stretches every entity named in `ids` by `factors` about `anchorMm`.
 *
 * Factors of exactly 1 on both axes, a non-finite or collapsed factor, an empty
 * id set, or ids that match nothing all return the SAME sketch object, so a
 * gesture that has not moved yet costs nothing and cannot be mistaken for a
 * change.
 */
export function stretchEntities(
  sketch: Sketch,
  ids: ReadonlySet<string>,
  anchorMm: Vec2,
  factors: StretchFactors,
): Sketch {
  if (ids.size === 0) return sketch;
  if (factors.x === 1 && factors.y === 1) return sketch;
  if (!isUsableFactor(factors.x) || !isUsableFactor(factors.y)) return sketch;
  if (!Number.isFinite(anchorMm.x) || !Number.isFinite(anchorMm.y)) return sketch;
  let changed = false;
  const entities = sketch.entities.map((entity) => {
    if (!ids.has(entity.id)) return entity;
    changed = true;
    return stretchEntity(entity, anchorMm, factors);
  });
  return changed ? { ...sketch, entities } : sketch;
}

function isUsableFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor >= MIN_SCALE_FACTOR;
}

// The arc keeps its id, layer and construction flag: this is the same entity
// the operator drew, now carried as the geometry a stretch actually produces.
function bakedArc(
  entity: Extract<SketchEntity, { readonly kind: 'arc' }>,
  about: (point: Vec2) => Vec2,
): SketchEntity {
  const sampled = entityToPolylines(entity)[0];
  if (sampled === undefined) return entity;
  return {
    ...entityBase(entity),
    kind: 'path',
    points: sampled.points.map(about),
    closed: sampled.closed,
  };
}
