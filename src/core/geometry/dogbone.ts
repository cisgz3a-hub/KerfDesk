// Dogbone corner relief (ADR-103 G6, F-CNC26). A round bit cannot reach into
// a corner sharper than its radius, so slot-fit joinery relieves each sharp
// corner with a bit-sized overcut. Style (PROVISIONAL, documented in the
// flow): a circle of one bit RADIUS centered ON the corner vertex — the
// "corner overcut" variant that guarantees a square mating part seats fully;
// directional dogbone/T-bone placement is future refinement.
//
// Model: the object's rings are unioned into a region (NonZero); convex
// corners of the region's OUTER boundaries with interior angle below the
// threshold get relief circles; hole rings (islands of remaining material)
// are left alone in v1. The circles are unioned back into the region.

import { unionD, FillRule, type PathD, type PathsD } from 'clipper2-ts';
import { IDENTITY_TRANSFORM, type ColoredPath, type ImportedSvg, type Vec2 } from '../scene';
import {
  boundsForPaths,
  isClosedPolygon,
  materializeVectorObject,
  pathDToPolyline,
  polylineToPathD,
  type VectorSceneObject,
} from './vector-path-tools';

export const DOGBONE_MAX_CORNER_DEG = 135;
const CIRCLE_SEGMENTS = 24;
const MIN_EDGE_MM = 1e-6;
const FALLBACK_COLOR = '#000000';

/**
 * Relieve the sharp convex corners of one object's cut region. Returns the
 * corner-relieved object (identity transform, world-space baked, same id) or
 * throws when the selection has no closed contours / no qualifying corners.
 */
export function dogboneVectorObject(object: VectorSceneObject, bitDiameterMm: number): ImportedSvg {
  if (!Number.isFinite(bitDiameterMm) || bitDiameterMm <= 0) {
    throw new Error('Dogbone needs a positive bit diameter.');
  }
  const materialized = materializeVectorObject(object);
  const region = unionD(collectClosedRings(materialized), FillRule.NonZero);
  const radius = bitDiameterMm / 2;
  const circles: PathsD = [];
  for (const ring of region) {
    // Clipper orients outers CCW (positive area); holes CW. Holes = islands
    // of remaining material — not relieved in v1.
    if (signedArea(ring) <= 0) continue;
    for (const corner of sharpConvexCorners(ring)) {
      circles.push(circlePath(corner, radius));
    }
  }
  if (circles.length === 0) {
    throw new Error(
      `No corners sharper than ${DOGBONE_MAX_CORNER_DEG}° to relieve in this selection.`,
    );
  }
  const relieved = unionD([...region, ...circles], FillRule.NonZero);
  const paths: ColoredPath[] = [
    {
      color: materialized.paths[0]?.color ?? FALLBACK_COLOR,
      polylines: relieved.map(pathDToPolyline).filter(isClosedPolygon),
    },
  ];
  return {
    kind: 'imported-svg',
    id: object.id,
    source: `${materialized.source.replace(/ \(paths\)$/, '')} (dogbone)`,
    bounds: boundsForPaths(paths) ?? object.bounds,
    transform: IDENTITY_TRANSFORM,
    paths,
  };
}

function collectClosedRings(materialized: ImportedSvg): PathsD {
  const rings: PathsD = [];
  for (const path of materialized.paths) {
    for (const polyline of path.polylines) {
      if (!isClosedPolygon(polyline)) {
        throw new Error('Dogbone applies to closed contours only.');
      }
      rings.push(polylineToPathD(polyline));
    }
  }
  return rings;
}

function signedArea(ring: PathD): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (a === undefined || b === undefined) continue;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

// Convex (for a CCW ring) vertices whose interior angle < the threshold.
function sharpConvexCorners(ring: PathD): ReadonlyArray<Vec2> {
  const corners: Vec2[] = [];
  const n = ring.length;
  const maxRad = (DOGBONE_MAX_CORNER_DEG * Math.PI) / 180;
  for (let i = 0; i < n; i += 1) {
    const prev = ring[(i + n - 1) % n];
    const curr = ring[i];
    const next = ring[(i + 1) % n];
    if (prev === undefined || curr === undefined || next === undefined) continue;
    const ax = prev.x - curr.x;
    const ay = prev.y - curr.y;
    const bx = next.x - curr.x;
    const by = next.y - curr.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < MIN_EDGE_MM || lb < MIN_EDGE_MM) continue;
    // CCW ring: convex where the outgoing edge turns left of the incoming.
    const cross = ax * by - ay * bx;
    if (cross >= 0) continue;
    const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (la * lb)));
    const interior = Math.acos(cos);
    if (interior < maxRad) corners.push({ x: curr.x, y: curr.y });
  }
  return corners;
}

function circlePath(center: Vec2, radius: number): PathD {
  const points: PathD = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i += 1) {
    const angle = (i / CIRCLE_SEGMENTS) * 2 * Math.PI;
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  return points;
}
