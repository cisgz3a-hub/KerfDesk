// to-scene-object — turn one finished sketch entity into a scene object
// (ADR-268, Phase N DS-5). This is the Studio's single crossing point into the
// project: everything downstream (compile, preview, emit, save) then treats a
// designed part exactly like imported artwork, which is why the pipeline needed
// no changes at all.
//
// Two carriers, chosen per entity by ONE rule: use a parametric ShapeSpec only
// where it represents the entity EXACTLY, and a baked vector object otherwise.
//
//  - rect   -> kind:'shape' spec 'rect'    — exact, and stays re-editable on the
//              main canvas (corner-radius handle, Shape properties).
//  - circle -> kind:'shape' spec 'ellipse' — exact (a circle is an ellipse with
//              equal axes), likewise re-editable.
//  - line / arc / path -> kind:'imported-svg' carrying exact polylines.
//
// Why not createPolyline for the third group: it FAIRS its input above a minimum
// point count (roundPolylineCurve / fairLineCurvePath), and ADR-214's fairing
// migration re-fairs anything stamped below the current version. Either would
// quietly bend a precisely specified arc. The baked imported-svg carrier is the
// established home for generated geometry that must not be re-fitted (box
// panels, dogbone, weld all use it) and nothing re-fairs it.

import {
  IDENTITY_TRANSFORM,
  type Bounds,
  type ImportedSvg,
  type Polyline,
  type SceneObject,
  type ShapeObject,
} from '../scene';
import { createEllipse, createRectangle } from '../shapes/primitives';
import { entityToPolylines } from './entity-geometry';
import type { SketchEntity } from './sketch-entity';

// Prefix marks these as generated, so Phase C re-import replace-by-source can
// never mistake a designed part for an imported file (the box-panel convention).
export const DESIGN_SOURCE_PREFIX = 'Design: ';

/**
 * Converts one sketch entity into a scene object ready to insert.
 *
 * Returns null for construction geometry — a guide is drawn to design against
 * and is deliberately never emitted — and for any entity too degenerate to
 * materialize. Null means "nothing to add", never an error.
 */
export function designEntityToSceneObject(
  entity: SketchEntity,
  id: string,
  color: string,
): SceneObject | null {
  if (entity.construction === true) return null;
  switch (entity.kind) {
    case 'rect':
      return rectangleObject(entity, id, color);
    case 'circle':
      return circleObject(entity, id, color);
    case 'line':
    case 'arc':
    case 'path':
      return bakedObject(entity, id, color);
  }
}

// createRectangle builds its geometry in local space with the minimum corner at
// the origin, so the sketch position becomes the transform.
function rectangleObject(
  entity: Extract<SketchEntity, { readonly kind: 'rect' }>,
  id: string,
  color: string,
): ShapeObject | null {
  if (!(entity.widthMm > 0) || !(entity.heightMm > 0)) return null;
  return createRectangle({
    id,
    color,
    spec: {
      widthMm: entity.widthMm,
      heightMm: entity.heightMm,
      cornerRadiusMm: entity.cornerRadiusMm,
    },
    transform: { ...IDENTITY_TRANSFORM, x: entity.origin.x, y: entity.origin.y },
  });
}

// An ellipse is also top-left placed, so a circle's transform is its centre less
// the radius on both axes.
function circleObject(
  entity: Extract<SketchEntity, { readonly kind: 'circle' }>,
  id: string,
  color: string,
): ShapeObject | null {
  if (!(entity.radiusMm > 0)) return null;
  const diameterMm = entity.radiusMm * 2;
  return createEllipse({
    id,
    color,
    spec: { widthMm: diameterMm, heightMm: diameterMm },
    transform: {
      ...IDENTITY_TRANSFORM,
      x: entity.center.x - entity.radiusMm,
      y: entity.center.y - entity.radiusMm,
    },
  });
}

// Exact geometry, already in world millimetres, under an identity transform so
// no placement maths can shift it.
function bakedObject(entity: SketchEntity, id: string, color: string): ImportedSvg | null {
  const polylines = entityToPolylines(entity);
  if (polylines.length === 0) return null;
  return {
    kind: 'imported-svg',
    id,
    source: `${DESIGN_SOURCE_PREFIX}${entity.kind}`,
    bounds: boundsOfPolylineList(polylines),
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines }],
  };
}

function boundsOfPolylineList(polylines: ReadonlyArray<Polyline>): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const polyline of polylines) {
    for (const point of polyline.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}
