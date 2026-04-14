/**
 * Path offset (inset/outset) for kerf compensation via polygon-offset.
 */

import Offset from 'polygon-offset';
import type { MultiPolygon } from 'polygon-clipping';
import type { SceneObject } from '../core/scene/SceneObject';
import type { PathGeometry } from '../core/scene/SceneObject';
import { objectToPolygon, polygonToPathGeometry } from './BooleanOps';

/** True if `raw` is MultiPolygon (array of polygons); false if single Polygon (array of rings). */
function isMultiPolygonShape(raw: unknown): raw is MultiPolygon {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return false;
  const a0 = raw[0] as unknown[];
  if (!Array.isArray(a0) || a0.length === 0) return false;
  const first0 = a0[0] as unknown;
  if (!Array.isArray(first0)) return false;
  return typeof first0[0] !== 'number';
}

/**
 * Offset each outer ring of the object's polygon representation (world space).
 * Positive distance = outset (margin), negative = inset (padding).
 */
export function offsetObject(obj: SceneObject, distance: number): PathGeometry | null {
  if (distance === 0) return null;

  const multi = objectToPolygon(obj);
  if (!multi || multi.length === 0) return null;

  const combined: MultiPolygon = [];

  for (const poly of multi) {
    const outerRing = poly[0];
    if (!outerRing || outerRing.length < 3) continue;

    let raw: unknown;
    try {
      const offset = new Offset();
      if (distance > 0) {
        raw = offset.data(outerRing).margin(Math.abs(distance));
      } else {
        raw = offset.data(outerRing).padding(Math.abs(distance));
      }
    } catch (e) {
      console.error('Offset failed:', e);
      continue;
    }

    if (!raw || !Array.isArray(raw) || raw.length === 0) continue;

    if (isMultiPolygonShape(raw)) {
      for (const p of raw as MultiPolygon) {
        combined.push(p);
      }
    } else {
      combined.push(raw as MultiPolygon[number]);
    }
  }

  if (combined.length === 0) return null;

  const pathGeom = polygonToPathGeometry(combined);
  if (pathGeom.subPaths.length === 0) return null;

  return pathGeom;
}
