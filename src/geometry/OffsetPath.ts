/**
 * Path offset (inset/outset) for kerf compensation via polygon-offset.
 *
 * T1-36: pre-T1-36 only `poly[0]` (the outer ring) was offset; holes
 * were silently dropped. For kerf compensation that means the inner
 * contour of any donut / gear / inlay / closed-loop letter stayed at
 * design size, so the laser kerf shaved BOTH sides of the inner edge
 * and produced a too-small hole. The fix passes holes through to
 * polygon-offset alongside the outer; the library accepts a polygon
 * with multiple rings (outer + holes) as long as the rings have the
 * canonical winding (outer CCW, hole CW). We enforce winding via
 * signed-area sign before passing to offset.
 */

import Offset from 'polygon-offset';
import type { MultiPolygon } from 'polygon-clipping';
import type { CompoundPath } from '../core/geometry/CompoundPath';
import type { SceneObject } from '../core/scene/SceneObject';
import type { PathGeometry } from '../core/scene/SceneObject';
import { objectToPolygon, polygonToPathGeometry } from './BooleanOps';
import { compoundPathToMultiPolygon } from './CompoundPathPolygon';

type Coord = [number, number];
type Ring = Coord[];

/** True if `raw` is MultiPolygon (array of polygons); false if single Polygon (array of rings). */
function isMultiPolygonShape(raw: unknown): raw is MultiPolygon {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return false;
  const a0 = raw[0] as unknown[];
  if (!Array.isArray(a0) || a0.length === 0) return false;
  const first0 = a0[0] as unknown;
  if (!Array.isArray(first0)) return false;
  return typeof first0[0] !== 'number';
}

function ringSignedArea(ring: Ring): number {
  let area = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

/**
 * Reverse the ring's vertex order, preserving the closing-vertex
 * convention (last == first).
 */
function reverseRing(ring: Ring): Ring {
  const reversed = ring.slice(0, ring.length - 1).reverse();
  reversed.push([reversed[0][0], reversed[0][1]] as Coord);
  return reversed;
}

/**
 * Force `ring` to the requested winding via signed area: positive =
 * CCW in standard math coords; negative = CW. The sign-of-area
 * convention is consistent regardless of whether the embedding has
 * Y-up or Y-down — we just need outers and holes to be opposite.
 */
function ensureWinding(ring: Ring, wantCCW: boolean): Ring {
  const a = ringSignedArea(ring);
  const isCCW = a > 0;
  return isCCW === wantCCW ? ring : reverseRing(ring);
}

/**
 * T2-15 Pass 3: build polygon-offset input directly from CompoundPath
 * roles. This keeps explicit outer/hole/island structure until the
 * offset boundary instead of asking loose subpaths to rediscover it.
 */
export function compoundPathToOffsetMultiPolygon(path: CompoundPath): MultiPolygon {
  return compoundPathToMultiPolygon(path);
}

/**
 * Offset the object's polygon representation (world space), preserving
 * holes. Positive distance = outset (margin), negative = inset (padding).
 *
 * For a compound polygon (outer + holes), polygon-offset's `margin` /
 * `padding` operates on the whole polygon: outer expands/contracts
 * outward, holes contract/expand inward (toward material). Net effect
 * for kerf comp: a +1mm margin on a 50×50 square with a 20×20 hole
 * yields a 52×52 outer with an 18×18 inner — both contours displaced
 * by 1mm into / out of the material as intended.
 */
function offsetMultiPolygon(multi: MultiPolygon, distance: number): PathGeometry | null {
  if (distance === 0) return null;
  if (!multi || multi.length === 0) return null;

  const combined: MultiPolygon = [];

  for (const poly of multi) {
    const outerRing = poly[0];
    if (!outerRing || outerRing.length < 3) continue;

    // T1-36: enforce canonical winding before passing to polygon-offset.
    // Outer = CCW, holes = CW. The library uses winding to distinguish
    // "outside" from "inside" of the compound polygon.
    const wantedOuter = ensureWinding(outerRing as Ring, /* wantCCW */ true);
    const wantedHoles: Ring[] = [];
    for (let i = 1; i < poly.length; i++) {
      const h = poly[i];
      if (!h || h.length < 3) continue;
      wantedHoles.push(ensureWinding(h as Ring, /* wantCCW */ false));
    }

    let raw: unknown;
    try {
      const offset = new Offset();
      const polygonWithHoles: Ring[] = [wantedOuter, ...wantedHoles];
      const arg: Ring | Ring[] = wantedHoles.length === 0 ? wantedOuter : polygonWithHoles;
      if (distance > 0) {
        raw = offset.data(arg).margin(Math.abs(distance));
      } else {
        raw = offset.data(arg).padding(Math.abs(distance));
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

export function offsetCompoundPath(path: CompoundPath, distance: number): PathGeometry | null {
  return offsetMultiPolygon(compoundPathToOffsetMultiPolygon(path), distance);
}

export function offsetObject(obj: SceneObject, distance: number): PathGeometry | null {
  if (distance === 0) return null;

  const multi = objectToPolygon(obj);
  return multi ? offsetMultiPolygon(multi, distance) : null;
}
