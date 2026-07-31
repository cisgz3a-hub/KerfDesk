// fillet-corner — round a path corner (ADR-271, DS-6).
//
// The vertex is replaced by a tangent arc, sampled through the SAME
// ARC_CHORD_TOLERANCE_MM the importer and the .nc parser use, so a filleted corner
// is no coarser than an imported one and the Studio adds no tolerance of its own.
//
// Unlike chamfer this is an approximation at the chord level, which is why the
// radius that was asked for is reported back: the caller can show the operator the
// exact value the geometry now carries.

import { sampleArcPoints } from '../../geometry';
import type { Vec2 } from '../../scene';
import type { SketchPath } from '../sketch-entity';
import { cornerNeighbours, replaceVertex } from './chamfer-corner';
import {
  angleOfMm,
  cornerSetback,
  filletCentreMm,
  filletSetbackMm,
  shortestSweepRad,
} from './corner-geometry';

export type FilletResult = {
  readonly path: SketchPath;
  // Where the arc's centre landed, so the UI can mark it or dimension from it.
  readonly centreMm: Vec2;
  readonly radiusMm: number;
};

/**
 * Fillets the corner at `cornerIndex` with a tangent arc of `radiusMm`.
 *
 * Returns null when the corner is degenerate, or when the radius needs more setback
 * than either neighbouring segment can give. A fillet needs MORE room than a
 * chamfer of the same size at a sharp corner (setback = r / tan(theta/2)), so a
 * radius that fails here may still chamfer.
 */
export function filletPathCorner(
  path: SketchPath,
  cornerIndex: number,
  radiusMm: number,
): FilletResult | null {
  const neighbours = cornerNeighbours(path, cornerIndex);
  if (neighbours === null) return null;
  // The interior angle is needed to size the setback, and the setback is needed to
  // know the angle fits — so measure the angle with a probe setback first.
  const probe = cornerSetback(
    neighbours.previousMm,
    neighbours.cornerMm,
    neighbours.nextMm,
    smallestLegMm(neighbours),
  );
  if (probe === null) return null;
  const setbackMm = filletSetbackMm(radiusMm, probe.interiorRad);
  if (setbackMm === null) return null;
  const setback = cornerSetback(
    neighbours.previousMm,
    neighbours.cornerMm,
    neighbours.nextMm,
    setbackMm,
  );
  if (setback === null) return null;
  const centreMm = filletCentreMm(neighbours.cornerMm, setback, radiusMm);
  if (centreMm === null) return null;
  const arc = arcThroughTangents(centreMm, setback.startMm, setback.endMm, radiusMm);
  return {
    path: { ...path, points: replaceVertex(path.points, cornerIndex, arc) },
    centreMm,
    radiusMm,
  };
}

// Walks from the incoming tangent point to the outgoing one the short way round,
// which is always the correct side for a corner fillet.
function arcThroughTangents(
  centreMm: Vec2,
  startMm: Vec2,
  endMm: Vec2,
  radiusMm: number,
): ReadonlyArray<Vec2> {
  const startRad = angleOfMm(centreMm, startMm);
  const endRad = angleOfMm(centreMm, endMm);
  const sweepRad = shortestSweepRad(startRad, endRad);
  const sampled = sampleArcPoints(centreMm, radiusMm, startRad, sweepRad);
  // Pin the ends to the exact tangent points: the sampler's endpoints are correct
  // to floating point, but the tangency is what keeps the fillet flush with the
  // legs, so it is stated exactly rather than left to rounding.
  return [startMm, ...sampled.slice(1, -1), endMm];
}

function smallestLegMm(neighbours: {
  readonly previousMm: Vec2;
  readonly cornerMm: Vec2;
  readonly nextMm: Vec2;
}): number {
  const previous = Math.hypot(
    neighbours.previousMm.x - neighbours.cornerMm.x,
    neighbours.previousMm.y - neighbours.cornerMm.y,
  );
  const next = Math.hypot(
    neighbours.nextMm.x - neighbours.cornerMm.x,
    neighbours.nextMm.y - neighbours.cornerMm.y,
  );
  return Math.min(previous, next);
}
