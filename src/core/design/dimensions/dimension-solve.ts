// dimension-solve — measure a dimension, and re-solve its own geometry when a
// driving value changes (ADR-272 Amendment 7, Phase N DS-7).
//
// Every re-solve is LOCAL and exact, by kind:
//   line length     the start stays, the end moves along the line
//   segment length  an open polyline's later points move with the segment's end
//                   (the rest of the outline keeps its shape); a closed
//                   outline moves only that end vertex, its neighbour absorbing it
//   width / height  the rectangle's origin corner stays
//   diameter/radius the centre (and an arc's start angle and sweep) stay
//   angle           the second line turns about the lines' intersection
// A value that would leave degenerate geometry is refused (null), never clamped.

import type { Vec2 } from '../../scene';
import { distance } from '../../geometry/point-math';
import { MIN_ENTITY_SIZE_MM, sanitizeEntity } from '../sketch-entity';
import type { Sketch, SketchEntity, SketchLine, SketchPath } from '../sketch-entity';
import { replaceEntity } from '../sketch-edit';
import {
  findSketchEntity,
  sketchDimensions,
  withDimensions,
  type DimensionKind,
  type SketchDimension,
} from './sketch-dimension';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const PARALLEL_EPSILON = 1e-9;
const STRAIGHT_DEG = 180;

type Reader = (entity: SketchEntity, dimension: SketchDimension, sketch: Sketch) => number | null;

const READERS: Readonly<Record<DimensionKind, Reader>> = {
  'line-length': (entity) => (entity.kind === 'line' ? distance(entity.start, entity.end) : null),
  'segment-length': (entity, dimension) => {
    const segment = pathSegment(entity, dimension.segmentIndex);
    return segment === null ? null : distance(segment.from, segment.to);
  },
  'rect-width': (entity) => (entity.kind === 'rect' ? entity.widthMm : null),
  'rect-height': (entity) => (entity.kind === 'rect' ? entity.heightMm : null),
  diameter: (entity) => (entity.kind === 'circle' ? entity.radiusMm * 2 : null),
  radius: (entity) => (entity.kind === 'circle' || entity.kind === 'arc' ? entity.radiusMm : null),
  angle: (_entity, dimension, sketch) => lineAngle(sketch, dimension)?.angleDeg ?? null,
};

/** The dimension's current reading, or null when what it names is gone or unmeasurable. */
export function measureDimension(sketch: Sketch, dimension: SketchDimension): number | null {
  const entity = findSketchEntity(sketch, dimension.entityId);
  return entity === null ? null : READERS[dimension.kind](entity, dimension, sketch);
}

/**
 * The sketch with the dimension's geometry re-solved to `value`, and the
 * dimension made driving at that value. Null when the value cannot be honoured:
 * a size at or below the smallest entity, an angle outside 0..180, or geometry
 * the dimension no longer names.
 */
export function driveDimension(
  sketch: Sketch,
  dimension: SketchDimension,
  value: number,
): Sketch | null {
  if (!Number.isFinite(value)) return null;
  const entity = findSketchEntity(sketch, dimension.entityId);
  if (entity === null) return null;
  const solved =
    dimension.kind === 'angle'
      ? turnSecondLine(sketch, dimension, value)
      : resize(entity, dimension, value);
  if (solved === null || sanitizeEntity(solved) === null) return null;
  const next = replaceEntity(sketch, solved);
  const driving: SketchDimension = { ...dimension, driving: true, value };
  return withDimensions(
    next,
    sketchDimensions(next).map((existing) => (existing.id === dimension.id ? driving : existing)),
  );
}

/**
 * Every driving dimension re-imposed, and every dimension whose geometry is
 * gone dropped. Returns the SAME sketch when nothing needed changing, so a
 * caller can still tell "no edit" by identity.
 */
export function enforceDimensions(sketch: Sketch): Sketch {
  const dimensions = sketchDimensions(sketch);
  if (dimensions.length === 0) return sketch;
  const live = dimensions.filter((dimension) => measureDimension(sketch, dimension) !== null);
  let next = live.length === dimensions.length ? sketch : withDimensions(sketch, live);
  for (const dimension of live) {
    if (!dimension.driving || dimension.value === undefined) continue;
    const reading = measureDimension(next, dimension);
    if (reading === null || sameValue(reading, dimension.value)) continue;
    next = driveDimension(next, dimension, dimension.value) ?? next;
  }
  return next;
}

/** A driving dimension made driven (a reference) or a driven one made driving at its reading. */
export function setDimensionDriving(sketch: Sketch, id: string, driving: boolean): Sketch {
  const dimensions = sketchDimensions(sketch).map((dimension): SketchDimension => {
    if (dimension.id !== id) return dimension;
    if (!driving) {
      return {
        id: dimension.id,
        kind: dimension.kind,
        entityId: dimension.entityId,
        ...(dimension.segmentIndex === undefined ? {} : { segmentIndex: dimension.segmentIndex }),
        ...(dimension.otherEntityId === undefined
          ? {}
          : { otherEntityId: dimension.otherEntityId }),
        driving: false,
      };
    }
    const reading = measureDimension(sketch, dimension);
    return reading === null ? dimension : { ...dimension, driving: true, value: reading };
  });
  return withDimensions(sketch, dimensions);
}

type Resizer = (
  entity: SketchEntity,
  dimension: SketchDimension,
  value: number,
) => SketchEntity | null;

const RESIZERS: Readonly<Record<Exclude<DimensionKind, 'angle'>, Resizer>> = {
  'line-length': (entity, _dimension, value) =>
    entity.kind === 'line' ? { ...entity, end: along(entity.start, entity.end, value) } : null,
  'segment-length': (entity, dimension, value) =>
    entity.kind === 'path' ? resizeSegment(entity, dimension.segmentIndex, value) : null,
  'rect-width': (entity, _dimension, value) =>
    entity.kind === 'rect' ? { ...entity, widthMm: value } : null,
  'rect-height': (entity, _dimension, value) =>
    entity.kind === 'rect' ? { ...entity, heightMm: value } : null,
  diameter: (entity, _dimension, value) =>
    entity.kind === 'circle' ? { ...entity, radiusMm: value / 2 } : null,
  radius: (entity, _dimension, value) =>
    entity.kind === 'circle' || entity.kind === 'arc' ? { ...entity, radiusMm: value } : null,
};

function resize(
  entity: SketchEntity,
  dimension: SketchDimension,
  value: number,
): SketchEntity | null {
  if (value < MIN_ENTITY_SIZE_MM || dimension.kind === 'angle') return null;
  return RESIZERS[dimension.kind](entity, dimension, value);
}

function resizeSegment(
  path: SketchPath,
  index: number | undefined,
  value: number,
): SketchPath | null {
  const segment = pathSegment(path, index);
  if (segment === null || index === undefined) return null;
  const target = along(segment.from, segment.to, value);
  const shift = { x: target.x - segment.to.x, y: target.y - segment.to.y };
  const toIndex = (index + 1) % path.points.length;
  const points = path.points.map((point, at) => {
    const moves = path.closed ? at === toIndex : at > index;
    return moves ? { x: point.x + shift.x, y: point.y + shift.y } : point;
  });
  return { ...path, points };
}

type LineAngle = {
  readonly angleDeg: number;
  readonly pivot: Vec2;
  readonly first: SketchLine;
  readonly second: SketchLine;
};

/**
 * The angle between two lines, measured between the halves that leave their
 * intersection toward each line's far end - the angle a draughtsman would mark.
 * Null for parallel lines, whose angle has no vertex.
 */
export function lineAngle(sketch: Sketch, dimension: SketchDimension): LineAngle | null {
  const first = findSketchEntity(sketch, dimension.entityId);
  const second =
    dimension.otherEntityId === undefined
      ? null
      : findSketchEntity(sketch, dimension.otherEntityId);
  if (first?.kind !== 'line' || second?.kind !== 'line') return null;
  const pivot = intersection(first, second);
  if (pivot === null) return null;
  const a = awayFrom(pivot, first);
  const b = awayFrom(pivot, second);
  const cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
  return { angleDeg: Math.acos(Math.max(-1, Math.min(1, cos))) * RAD_TO_DEG, pivot, first, second };
}

function turnSecondLine(
  sketch: Sketch,
  dimension: SketchDimension,
  valueDeg: number,
): SketchEntity | null {
  if (!(valueDeg > 0 && valueDeg < STRAIGHT_DEG)) return null;
  const measured = lineAngle(sketch, dimension);
  if (measured === null) return null;
  const { pivot, first, second } = measured;
  const a = awayFrom(pivot, first);
  const b = awayFrom(pivot, second);
  // Keep the second line on the side of the first it is on now.
  const side = a.x * b.y - a.y * b.x < 0 ? -1 : 1;
  const target = Math.atan2(a.y, a.x) + side * valueDeg * DEG_TO_RAD;
  const turn = target - Math.atan2(b.y, b.x);
  return {
    ...second,
    start: rotate(second.start, pivot, turn),
    end: rotate(second.end, pivot, turn),
  };
}

function intersection(first: SketchLine, second: SketchLine): Vec2 | null {
  const r = { x: first.end.x - first.start.x, y: first.end.y - first.start.y };
  const s = { x: second.end.x - second.start.x, y: second.end.y - second.start.y };
  const denominator = r.x * s.y - r.y * s.x;
  const scale = Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y);
  if (scale === 0 || Math.abs(denominator) <= PARALLEL_EPSILON * scale) return null;
  const qp = { x: second.start.x - first.start.x, y: second.start.y - first.start.y };
  const t = (qp.x * s.y - qp.y * s.x) / denominator;
  return { x: first.start.x + r.x * t, y: first.start.y + r.y * t };
}

// The direction from the pivot toward the line's farther end.
function awayFrom(pivot: Vec2, line: SketchLine): Vec2 {
  const far = distance(pivot, line.start) > distance(pivot, line.end) ? line.start : line.end;
  return { x: far.x - pivot.x, y: far.y - pivot.y };
}

export function pathSegment(
  entity: SketchEntity,
  index: number | undefined,
): { readonly from: Vec2; readonly to: Vec2 } | null {
  if (entity.kind !== 'path' || index === undefined || !Number.isInteger(index) || index < 0) {
    return null;
  }
  const count = entity.closed ? entity.points.length : entity.points.length - 1;
  if (index >= count) return null;
  const from = entity.points[index];
  const to = entity.points[(index + 1) % entity.points.length];
  return from === undefined || to === undefined ? null : { from, to };
}

function along(from: Vec2, to: Vec2, length: number): Vec2 {
  const reach = distance(from, to);
  const ux = reach > 0 ? (to.x - from.x) / reach : 1;
  const uy = reach > 0 ? (to.y - from.y) / reach : 0;
  return { x: from.x + ux * length, y: from.y + uy * length };
}

function rotate(point: Vec2, pivot: Vec2, turn: number): Vec2 {
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
}

function sameValue(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}
