// Extend a straight terminal segment to the first forward contact. Preview and
// commit share this query; no approximation is used for curved boundaries.
import type { Vec2 } from '../../scene';
import { replaceEntity } from '../sketch-edit';
import type { Sketch, SketchEntity } from '../sketch-entity';
import { boundaryContacts, EXTEND_EPS_MM } from './extend-boundaries';

export type SketchExtension = {
  readonly entityId: string;
  readonly end: 'start' | 'end';
  readonly from: Vec2;
  readonly to: Vec2 | null;
  readonly reason: 'ready' | 'no-boundary' | 'already-touching' | 'overlap' | 'curved-source';
};
type Endpoint = {
  readonly entity: SketchEntity;
  readonly end: 'start' | 'end';
  readonly from: Vec2;
  readonly adjacent: Vec2 | null;
};

export function findSketchExtension(
  sketch: Sketch,
  pointer: Vec2,
  toleranceMm: number,
): SketchExtension | null {
  if (!Number.isFinite(toleranceMm) || toleranceMm < 0) return null;
  let picked: Endpoint | null = null;
  let best = toleranceMm;
  for (const entity of [...sketch.entities].reverse()) {
    for (const endpoint of endpoints(entity)) {
      const distance = Math.hypot(pointer.x - endpoint.from.x, pointer.y - endpoint.from.y);
      if (distance <= toleranceMm && (picked === null || distance < best - EXTEND_EPS_MM)) {
        picked = endpoint;
        best = distance;
      }
    }
  }
  return picked === null ? null : extendEndpoint(sketch, picked);
}

function endpoints(entity: SketchEntity): Endpoint[] {
  if (entity.kind === 'arc') {
    if (Math.abs(entity.sweepDeg) >= 360) return [];
    return (['start', 'end'] as const).map((end) => {
      const degrees = entity.startAngleDeg + (end === 'end' ? entity.sweepDeg : 0);
      const angle = (degrees * Math.PI) / 180;
      return {
        entity,
        end,
        adjacent: null,
        from: {
          x: entity.center.x + entity.radiusMm * Math.cos(angle),
          y: entity.center.y + entity.radiusMm * Math.sin(angle),
        },
      };
    });
  }
  const points =
    entity.kind === 'line'
      ? [entity.start, entity.end]
      : entity.kind === 'path' && !entity.closed
        ? entity.points
        : [];
  const first = points[0];
  const last = points.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    Math.hypot(first.x - last.x, first.y - last.y) <= EXTEND_EPS_MM
  )
    return [];
  return [
    { entity, end: 'start', from: first, adjacent: points[1] ?? null },
    { entity, end: 'end', from: last, adjacent: points.at(-2) ?? null },
  ].filter(
    ({ from, adjacent }) =>
      adjacent !== null && Math.hypot(from.x - adjacent.x, from.y - adjacent.y) > EXTEND_EPS_MM,
  ) as Endpoint[];
}

function extendEndpoint(sketch: Sketch, picked: Endpoint): SketchExtension {
  const base = { entityId: picked.entity.id, end: picked.end, from: picked.from, to: null };
  if (picked.adjacent === null) return { ...base, reason: 'curved-source' };
  const dx = picked.from.x - picked.adjacent.x;
  const dy = picked.from.y - picked.adjacent.y;
  const length = Math.hypot(dx, dy);
  const direction = { x: dx / length, y: dy / length };
  const contacts = sketch.entities
    .filter((entity) => entity.id !== picked.entity.id)
    .flatMap((entity) => boundaryContacts({ from: picked.from, direction }, entity))
    .sort((a, b) => a.distance - b.distance || Number(b.overlap) - Number(a.overlap));
  const first = contacts[0];
  if (first === undefined) return { ...base, reason: 'no-boundary' };
  if (first.distance <= EXTEND_EPS_MM) return { ...base, reason: 'already-touching' };
  if (first.overlap) return { ...base, reason: 'overlap' };
  return {
    ...base,
    reason: 'ready',
    to: {
      x: picked.from.x + direction.x * first.distance,
      y: picked.from.y + direction.y * first.distance,
    },
  };
}

export function applySketchExtension(sketch: Sketch, extension: SketchExtension): Sketch {
  if (extension.reason !== 'ready' || extension.to === null) return sketch;
  const entity = sketch.entities.find((entry) => entry.id === extension.entityId);
  if (entity === undefined) return sketch;
  if (entity.kind === 'line') {
    return replaceEntity(sketch, { ...entity, [extension.end]: extension.to });
  }
  if (entity.kind !== 'path' || entity.closed) return sketch;
  const index = extension.end === 'start' ? 0 : entity.points.length - 1;
  return replaceEntity(sketch, {
    ...entity,
    points: entity.points.map((point, i) => (i === index ? (extension.to as Vec2) : point)),
  });
}
