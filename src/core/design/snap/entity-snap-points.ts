// entity-snap-points — the named reference points a single entity offers
// (ADR-272, Phase N DS-4): endpoints, midpoints, centres and quadrants.
//
// These are the points an operator reaches for by name — "the corner", "the centre
// of the hole", "halfway along that edge" — so they are derived from the entity's
// own definition rather than from its flattened chords. A circle's centre and its
// four quadrant points exist exactly, not as the nearest sampled vertex.

import type { Vec2 } from '../../scene';
import { entityToPolylines } from '../entity-geometry';
import type { SketchEntity } from '../sketch-entity';
import type { SnapTarget } from './snap-kinds';

const DEG_TO_RAD = Math.PI / 180;
const QUADRANT_ANGLES_DEG: ReadonlyArray<number> = [0, 90, 180, 270];

export function entitySnapPoints(entity: SketchEntity): ReadonlyArray<SnapTarget> {
  switch (entity.kind) {
    case 'line':
      return [
        target('endpoint', entity.start, entity.id),
        target('endpoint', entity.end, entity.id),
        target('midpoint', midpoint(entity.start, entity.end), entity.id),
      ];
    case 'circle':
      return [target('center', entity.center, entity.id), ...circleQuadrants(entity)];
    case 'ellipse':
      return [target('center', entity.center, entity.id), ...ellipseQuadrants(entity)];
    case 'arc':
      return arcPoints(entity);
    case 'rect':
      return rectPoints(entity);
    case 'path':
      return pathPoints(entity);
  }
}

function circleQuadrants(
  entity: Extract<SketchEntity, { readonly kind: 'circle' }>,
): ReadonlyArray<SnapTarget> {
  return QUADRANT_ANGLES_DEG.map((deg) =>
    target('quadrant', polar(entity.center, entity.radiusMm, deg), entity.id),
  );
}

// An ellipse's quadrants are the ends of its two axes — the four extreme points
// of its outline, which is what "the top of that hole" means on an ellipse just
// as it does on a circle.
function ellipseQuadrants(
  entity: Extract<SketchEntity, { readonly kind: 'ellipse' }>,
): ReadonlyArray<SnapTarget> {
  const { center, radiusXMm, radiusYMm } = entity;
  const points: ReadonlyArray<Vec2> = [
    { x: center.x + radiusXMm, y: center.y },
    { x: center.x, y: center.y + radiusYMm },
    { x: center.x - radiusXMm, y: center.y },
    { x: center.x, y: center.y - radiusYMm },
  ];
  return points.map((point) => target('quadrant', point, entity.id));
}

// An arc offers its centre, its two ends, and only the quadrants it actually
// sweeps through — snapping to a compass point the arc never reaches would be a
// snap to nothing.
function arcPoints(
  entity: Extract<SketchEntity, { readonly kind: 'arc' }>,
): ReadonlyArray<SnapTarget> {
  const start = polar(entity.center, entity.radiusMm, entity.startAngleDeg);
  const end = polar(entity.center, entity.radiusMm, entity.startAngleDeg + entity.sweepDeg);
  const swept = QUADRANT_ANGLES_DEG.filter((deg) => arcSweepsThrough(entity, deg)).map((deg) =>
    target('quadrant', polar(entity.center, entity.radiusMm, deg), entity.id),
  );
  return [
    target('center', entity.center, entity.id),
    target('endpoint', start, entity.id),
    target('endpoint', end, entity.id),
    target('midpoint', polar(entity.center, entity.radiusMm, midAngleDeg(entity)), entity.id),
    ...swept,
  ];
}

function midAngleDeg(entity: Extract<SketchEntity, { readonly kind: 'arc' }>): number {
  return entity.startAngleDeg + entity.sweepDeg / 2;
}

function arcSweepsThrough(
  entity: Extract<SketchEntity, { readonly kind: 'arc' }>,
  deg: number,
): boolean {
  // Offset of the compass point from the arc start, walked in the arc's own
  // direction and wrapped into 0..360, is inside the sweep exactly when it is no
  // larger than the sweep magnitude.
  const sweep = entity.sweepDeg;
  const raw = sweep >= 0 ? deg - entity.startAngleDeg : entity.startAngleDeg - deg;
  const offset = ((raw % 360) + 360) % 360;
  return offset <= Math.abs(sweep);
}

function rectPoints(
  entity: Extract<SketchEntity, { readonly kind: 'rect' }>,
): ReadonlyArray<SnapTarget> {
  const { origin, widthMm, heightMm } = entity;
  const right = origin.x + widthMm;
  const bottom = origin.y + heightMm;
  const corners: ReadonlyArray<Vec2> = [
    origin,
    { x: right, y: origin.y },
    { x: right, y: bottom },
    { x: origin.x, y: bottom },
  ];
  const edgeMidpoints: ReadonlyArray<Vec2> = [
    { x: origin.x + widthMm / 2, y: origin.y },
    { x: right, y: origin.y + heightMm / 2 },
    { x: origin.x + widthMm / 2, y: bottom },
    { x: origin.x, y: origin.y + heightMm / 2 },
  ];
  return [
    // The nominal corners stay available even on a rounded rectangle: they are
    // what the operator dimensioned, and the arc that replaces them is still
    // reachable through the point-on-line snap.
    ...corners.map((corner) => target('endpoint', corner, entity.id)),
    ...edgeMidpoints.map((point) => target('midpoint', point, entity.id)),
    target('center', { x: origin.x + widthMm / 2, y: origin.y + heightMm / 2 }, entity.id),
  ];
}

function pathPoints(
  entity: Extract<SketchEntity, { readonly kind: 'path' }>,
): ReadonlyArray<SnapTarget> {
  const targets: SnapTarget[] = [];
  for (const polyline of entityToPolylines(entity)) {
    const points = polyline.points;
    points.forEach((point) => targets.push(target('endpoint', point, entity.id)));
    for (let index = 0; index + 1 < points.length; index += 1) {
      const from = points[index];
      const to = points[index + 1];
      if (from === undefined || to === undefined) continue;
      targets.push(target('midpoint', midpoint(from, to), entity.id));
    }
  }
  return targets;
}

function target(kind: SnapTarget['kind'], atMm: Vec2, entityId: string): SnapTarget {
  return { kind, atMm, entityId };
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function polar(centre: Vec2, radiusMm: number, deg: number): Vec2 {
  const rad = deg * DEG_TO_RAD;
  return { x: centre.x + Math.cos(rad) * radiusMm, y: centre.y + Math.sin(rad) * radiusMm };
}
