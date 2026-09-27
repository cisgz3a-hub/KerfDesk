// Dogbone corner relief (ADR-103 G6, F-CNC26). A round bit cannot reach into
// a corner sharper than its radius, so slot-fit joinery relieves each sharp
// corner with the capsule the bit sweeps to touch it (corner-dogbone.ts,
// ADR-103 Amd 1). The earlier circle centred ON the vertex could only be cut
// with the bit centre exactly on the corner, an isolated point that pocket
// and inside-profile compensation skip, so it never changed the toolpath.
//
// Model: the object's rings are unioned into a region (NonZero); convex
// corners of the region's OUTER boundaries with interior angle below the
// threshold get dogbones; hole rings (islands of remaining material) are left
// alone in v1. The dogbones are unioned back into the region.

import { unionD, FillRule, type PathD, type PathsD } from 'clipper2-ts';
import { err, ok, type Result } from '../result';
import { IDENTITY_TRANSFORM, type ColoredPath, type ImportedSvg } from '../scene';
import {
  dogboneCorner,
  dogboneReliefPath,
  DOGBONE_PRECISION_DECIMALS,
  type DogboneCorner,
} from './corner-dogbone';
import {
  boundsForPaths,
  isClosedPolygon,
  materializeVectorObject,
  pathDToPolyline,
  polylineToPathD,
  tryVectorOp,
  type VectorOpError,
  type VectorSceneObject,
} from './vector-path-tools';

export const DOGBONE_MAX_CORNER_DEG = 135;
const MIN_EDGE_MM = 1e-6;
const FALLBACK_COLOR = '#000000';

/**
 * Relieve the sharp convex corners of one object's cut region. Returns the
 * corner-relieved object (identity transform, world-space baked, same id), or an
 * error result (ADR-131) when the selection has no closed contours / no
 * qualifying corners — the caller skips those objects silently (WORKFLOW F-CNC26).
 */
export function dogboneVectorObject(
  object: VectorSceneObject,
  bitDiameterMm: number,
): Result<ImportedSvg, VectorOpError> {
  if (!Number.isFinite(bitDiameterMm) || bitDiameterMm <= 0) {
    return err({ kind: 'bad-distance', message: 'Dogbone needs a positive bit diameter.' });
  }
  const materialized = materializeVectorObject(object);
  const rings = collectClosedRings(materialized);
  if (rings.kind === 'error') return rings;
  const regionResult = tryVectorOp(() => unionD(rings.value, FillRule.NonZero));
  if (regionResult.kind === 'error') return regionResult;
  const region = regionResult.value;
  const radius = bitDiameterMm / 2;
  const reliefs = dogboneReliefs(region, radius);
  if (reliefs.length === 0) {
    return err({
      kind: 'no-corners',
      message: `No corners sharper than ${DOGBONE_MAX_CORNER_DEG}° to relieve in this selection.`,
    });
  }
  const relieved = tryVectorOp(() =>
    unionD(region, reliefs, FillRule.NonZero, DOGBONE_PRECISION_DECIMALS),
  );
  if (relieved.kind === 'error') return relieved;
  const paths: ColoredPath[] = [
    {
      color: materialized.paths[0]?.color ?? FALLBACK_COLOR,
      polylines: relieved.value.map(pathDToPolyline).filter(isClosedPolygon),
    },
  ];
  return ok({
    kind: 'imported-svg',
    id: object.id,
    source: `${materialized.source.replace(/ \(paths\)$/, '')} (dogbone)`,
    bounds: boundsForPaths(paths) ?? object.bounds,
    transform: IDENTITY_TRANSFORM,
    paths,
  });
}

function dogboneReliefs(region: PathsD, radius: number): PathsD {
  const reliefs: PathsD = [];
  for (const ring of region) {
    // Clipper orients outers CCW (positive area); holes CW. Holes = islands
    // of remaining material — not relieved in v1.
    if (signedArea(ring) <= 0) continue;
    for (const corner of sharpConvexCorners(ring)) {
      reliefs.push(dogboneReliefPath(corner, radius));
    }
  }
  return reliefs;
}

function collectClosedRings(materialized: ImportedSvg): Result<PathsD, VectorOpError> {
  const rings: PathsD = [];
  for (const path of materialized.paths) {
    for (const polyline of path.polylines) {
      if (!isClosedPolygon(polyline)) {
        return err({ kind: 'open-contours', message: 'Dogbone applies to closed contours only.' });
      }
      rings.push(polylineToPathD(polyline));
    }
  }
  return ok(rings);
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

// Convex (for a CCW ring) vertices whose interior angle < the threshold; the
// open wedge is the region's interior.
function sharpConvexCorners(ring: PathD): ReadonlyArray<DogboneCorner> {
  const corners: DogboneCorner[] = [];
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
    if (interior >= maxRad) continue;
    const corner = dogboneCorner(prev, curr, next);
    if (corner !== null) corners.push(corner);
  }
  return corners;
}
