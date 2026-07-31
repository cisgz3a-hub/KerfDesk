// sketch-bounds — extents of sketch geometry (ADR-271, Phase N DS-1).
//
// Bounds are derived from MATERIALIZED geometry, not from the parametric block,
// so what the operator measures is exactly what gets cut. An arc's box is the
// box of the arc it actually sweeps, never the box of its whole circle.
//
// Construction entities are excluded from output bounds by
// `outputSketchBounds`; `sketchBounds` includes everything so the viewport can
// frame guides too.

import { boundsOfPolylines } from '../shapes';
import type { Bounds } from '../scene';
import { entityToPolylines } from './entity-geometry';
import type { Sketch, SketchEntity } from './sketch-entity';

export const EMPTY_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

export function entityBounds(entity: SketchEntity): Bounds {
  return boundsOfPolylines(entityToPolylines(entity));
}

export function sketchBounds(sketch: Sketch): Bounds {
  return boundsOfEntities(sketch.entities);
}

export function outputSketchBounds(sketch: Sketch): Bounds {
  return boundsOfEntities(sketch.entities.filter((entity) => entity.construction !== true));
}

export function boundsOfEntities(entities: ReadonlyArray<SketchEntity>): Bounds {
  const polylines = entities.flatMap((entity) => entityToPolylines(entity));
  return polylines.length === 0 ? EMPTY_BOUNDS : boundsOfPolylines(polylines);
}

export function boundsWidthMm(bounds: Bounds): number {
  return bounds.maxX - bounds.minX;
}

export function boundsHeightMm(bounds: Bounds): number {
  return bounds.maxY - bounds.minY;
}
