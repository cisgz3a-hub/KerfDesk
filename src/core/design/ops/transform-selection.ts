import type { Bounds, Vec2 } from '../../scene';
import { entityBounds } from '../sketch-bounds';
import { sanitizeEntity, type Sketch, type SketchArc, type SketchEntity } from '../sketch-entity';

export type DesignTransformKind =
  | 'rotate-left'
  | 'rotate-right'
  | 'flip-horizontal'
  | 'flip-vertical';

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
const angle = (degrees: number): number => ((degrees % 360) + 360) % 360;

/** Quarter turns retain editable primitives instead of flattening them to paths. */
export function transformSelection(
  sketch: Sketch,
  ids: ReadonlySet<string>,
  kind: DesignTransformKind,
): Sketch {
  // Match materialization's admission without tessellating curves or losing exact bounds.
  const selected = sketch.entities.flatMap((entity) => {
    const clean = ids.has(entity.id) ? sanitizeEntity(entity) : null;
    return clean === null ? [] : [clean];
  });
  if (selected.length === 0) return sketch;
  const drawable = new Map(selected.map((entity) => [entity.id, entity]));
  const boxes = selected.map(transformBounds);
  const bounds = {
    minX: Math.min(...boxes.map((box) => box.minX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
  };
  const pivot = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  if (!Number.isFinite(pivot.x) || !Number.isFinite(pivot.y)) return sketch;
  const point = (at: Vec2): Vec2 => transformPoint(at, pivot, kind);
  let changed = false;
  const entities = sketch.entities.map((entity) => {
    const source = drawable.get(entity.id);
    if (source === undefined) return entity;
    const next = transformEntity(source, point, kind);
    if (sameGeometry(entity, next)) return entity;
    changed = true;
    return next;
  });
  return changed ? { ...sketch, entities } : sketch;
}

function transformPoint(at: Vec2, pivot: Vec2, kind: DesignTransformKind): Vec2 {
  const x = at.x - pivot.x;
  const y = at.y - pivot.y;
  // The design canvas has Y increasing downwards: positive 90 degrees turns right.
  switch (kind) {
    case 'rotate-right':
      return { x: pivot.x - y, y: pivot.y + x };
    case 'rotate-left':
      return { x: pivot.x + y, y: pivot.y - x };
    case 'flip-horizontal':
      return { x: pivot.x - x, y: at.y };
    case 'flip-vertical':
      return { x: at.x, y: pivot.y - y };
  }
}

function transformEntity(
  entity: SketchEntity,
  point: (at: Vec2) => Vec2,
  kind: DesignTransformKind,
): SketchEntity {
  const rotate = kind === 'rotate-left' || kind === 'rotate-right';
  switch (entity.kind) {
    case 'line':
      return { ...entity, start: point(entity.start), end: point(entity.end) };
    case 'path':
      return { ...entity, points: entity.points.map(point) };
    case 'circle':
      return { ...entity, center: point(entity.center) };
    case 'ellipse':
      return {
        ...entity,
        center: point(entity.center),
        radiusXMm: rotate ? entity.radiusYMm : entity.radiusXMm,
        radiusYMm: rotate ? entity.radiusXMm : entity.radiusYMm,
      };
    case 'rect': {
      const a = point(entity.origin);
      const b = point({
        x: entity.origin.x + entity.widthMm,
        y: entity.origin.y + entity.heightMm,
      });
      return {
        ...entity,
        origin: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
        widthMm: rotate ? entity.heightMm : entity.widthMm,
        heightMm: rotate ? entity.widthMm : entity.heightMm,
      };
    }
    case 'arc':
      return transformArc(entity, point, kind);
  }
}

function transformArc(
  entity: SketchArc,
  point: (at: Vec2) => Vec2,
  kind: DesignTransformKind,
): SketchArc {
  const start = {
    'rotate-left': entity.startAngleDeg - 90,
    'rotate-right': entity.startAngleDeg + 90,
    'flip-horizontal': 180 - entity.startAngleDeg,
    'flip-vertical': -entity.startAngleDeg,
  }[kind];
  const reflected = kind === 'flip-horizontal' || kind === 'flip-vertical';
  return {
    ...entity,
    center: point(entity.center),
    startAngleDeg: angle(start),
    sweepDeg: reflected ? -entity.sweepDeg : entity.sweepDeg,
  };
}

// Exact curved bounds keep the pivot stable across successive quarter turns.
// A tessellated arc can miss its extrema and slowly shift the selection centre.
function transformBounds(entity: SketchEntity): Bounds {
  if (entity.kind === 'rect')
    return {
      minX: entity.origin.x,
      minY: entity.origin.y,
      maxX: entity.origin.x + entity.widthMm,
      maxY: entity.origin.y + entity.heightMm,
    };
  if (entity.kind === 'arc') return arcBounds(entity);
  if (entity.kind === 'circle' || entity.kind === 'ellipse') {
    const rx = entity.kind === 'circle' ? entity.radiusMm : entity.radiusXMm;
    const ry = entity.kind === 'circle' ? entity.radiusMm : entity.radiusYMm;
    return {
      minX: entity.center.x - rx,
      maxX: entity.center.x + rx,
      minY: entity.center.y - ry,
      maxY: entity.center.y + ry,
    };
  }
  return entityBounds(entity);
}

function arcBounds(entity: SketchArc): Bounds {
  const angles = [entity.startAngleDeg, entity.startAngleDeg + entity.sweepDeg];
  for (const cardinal of [0, 90, 180, 270]) {
    const distance =
      entity.sweepDeg >= 0
        ? angle(cardinal - entity.startAngleDeg)
        : angle(entity.startAngleDeg - cardinal);
    if (distance <= Math.abs(entity.sweepDeg)) angles.push(cardinal);
  }
  const points = angles.map((degrees) => ({
    x: entity.center.x + entity.radiusMm * Math.cos((degrees * Math.PI) / 180),
    y: entity.center.y + entity.radiusMm * Math.sin((degrees * Math.PI) / 180),
  }));
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

function sameGeometry(a: SketchEntity, b: SketchEntity): boolean {
  const before = transformValues(a);
  const after = transformValues(b);
  return (
    before.length === after.length &&
    before.every((value, index) => {
      const next = after[index];
      return next !== undefined && near(value, next);
    })
  );
}

/** Only fields changed by these transforms; entity kind and metadata always survive. */
function transformValues(entity: SketchEntity): number[] {
  switch (entity.kind) {
    case 'line':
      return [entity.start.x, entity.start.y, entity.end.x, entity.end.y];
    case 'path':
      return entity.points.flatMap((point) => [point.x, point.y]);
    case 'rect':
      return [entity.origin.x, entity.origin.y, entity.widthMm, entity.heightMm];
    case 'circle':
      return [entity.center.x, entity.center.y];
    case 'ellipse':
      return [entity.center.x, entity.center.y, entity.radiusXMm, entity.radiusYMm];
    case 'arc':
      return [entity.center.x, entity.center.y, angle(entity.startAngleDeg), entity.sweepDeg];
  }
}
