// resolve-snap — pick the one snap target the cursor should land on
// (ADR-268, Phase N DS-4).
//
// Priority beats proximity: an endpoint within range always wins over the
// point-on-line that lies on top of it, because "the corner" is what the operator
// meant. Distance only breaks ties inside one kind. Grid snapping stays separate
// and is applied by the caller only when nothing geometric was found — a real
// endpoint must never be dragged off by the grid.
//
// Tolerance arrives in millimetres; the caller converts a pixel radius through the
// current zoom so the reach feels identical however far in you are.

import type { Vec2 } from '../../scene';
import type { Sketch } from '../sketch-entity';
import { entitySnapPoints } from './entity-snap-points';
import { intersectionTargets } from './snap-intersections';
import { ALL_SNAP_KINDS, isBetterSnap, type SnapKind, type SnapTarget } from './snap-kinds';
import { closestPointOnSegment, distanceMm, sketchSegments } from './snap-segments';

export type SnapQuery = {
  readonly sketch: Sketch;
  readonly pointMm: Vec2;
  readonly toleranceMm: number;
  // Which kinds are live. Defaults to all of them.
  readonly kinds?: ReadonlySet<SnapKind>;
  // The entity currently being drawn or dragged, so it cannot snap to itself.
  readonly excludeEntityId?: string;
};

export type SnapResult = {
  readonly target: SnapTarget;
  readonly distanceMm: number;
};

export function resolveSnap(query: SnapQuery): SnapResult | null {
  if (!(query.toleranceMm > 0)) return null;
  const kinds = query.kinds ?? ALL_SNAP_KINDS;
  let best: SnapResult | null = null;
  for (const candidate of candidateTargets(query, kinds)) {
    if (!kinds.has(candidate.kind)) continue;
    const distance = distanceMm(candidate.atMm, query.pointMm);
    if (distance > query.toleranceMm) continue;
    if (
      isBetterSnap(
        { kind: candidate.kind, distanceMm: distance },
        best === null ? null : { kind: best.target.kind, distanceMm: best.distanceMm },
      )
    ) {
      best = { target: candidate, distanceMm: distance };
    }
  }
  return best;
}

function candidateTargets(
  query: SnapQuery,
  kinds: ReadonlySet<SnapKind>,
): ReadonlyArray<SnapTarget> {
  const named = query.sketch.entities
    .filter((entity) => entity.id !== query.excludeEntityId)
    .flatMap((entity) => entitySnapPoints(entity));
  const segments = sketchSegments(query.sketch, query.excludeEntityId);
  const onLine = kinds.has('on-line')
    ? segments.map(
        (segment): SnapTarget => ({
          kind: 'on-line',
          atMm: closestPointOnSegment(query.pointMm, segment),
          entityId: segment.entityId,
        }),
      )
    : [];
  // Intersections are computed last and only when live, because they are the one
  // O(n^2)-shaped candidate set even after the near-cursor filter.
  const crossings = kinds.has('intersection')
    ? intersectionTargets(segments, query.pointMm, query.toleranceMm)
    : [];
  return [...named, ...crossings, ...onLine];
}
