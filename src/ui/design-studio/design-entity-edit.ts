// design-entity-edit — typing an exact number back into the geometry
// (ADR-268, DS-3b). The write half of design-entity-fields.
//
// This is what makes the Studio precise rather than approximate: every dimension
// the inspector shows can be typed, and the entity is REBUILT from the number
// rather than nudged toward it. Dual entry, one model — the same value is reachable
// by dragging or by typing, exactly as LightBurn pairs Shape Properties with its
// on-canvas handles.
//
// Keyed lookup tables rather than switches, because MeasurementKey is a wide union
// and only a handful of its keys apply to any one shape.
//
// Editing rules chosen so a typed number never moves something the operator did not
// name: width grows from the origin (X/Y stay put), length grows along the existing
// direction (start stays put), angle rotates about the start, diameter is radius
// doubled.

import { sanitizeEntity, type SketchEntity } from '../../core/design';
import type { Vec2 } from '../../core/scene';
import type { ArcEntity } from './design-fields-arc';
import type { CircleEntity } from './design-fields-circle';
import type { LineEntity } from './design-fields-line';
import type { PathEntity } from './design-fields-path';
import type { RectEntity } from './design-fields-rect';
import { DEG_TO_RAD, type MeasurementKey } from './design-field-types';

type Edit<E> = (entity: E, value: number) => SketchEntity | null;
type EditTable<E> = Partial<Readonly<Record<MeasurementKey, Edit<E>>>>;

const RECT_EDITS: EditTable<RectEntity> = {
  x: (entity, value) => ({ ...entity, origin: { ...entity.origin, x: value } }),
  y: (entity, value) => ({ ...entity, origin: { ...entity.origin, y: value } }),
  width: (entity, value) => ({ ...entity, widthMm: value }),
  height: (entity, value) => ({ ...entity, heightMm: value }),
  cornerRadius: (entity, value) => ({ ...entity, cornerRadiusMm: value }),
};

const CIRCLE_EDITS: EditTable<CircleEntity> = {
  centerX: (entity, value) => ({ ...entity, center: { ...entity.center, x: value } }),
  centerY: (entity, value) => ({ ...entity, center: { ...entity.center, y: value } }),
  radius: (entity, value) => ({ ...entity, radiusMm: value }),
  diameter: (entity, value) => ({ ...entity, radiusMm: value / 2 }),
};

const LINE_EDITS: EditTable<LineEntity> = {
  startX: (entity, value) => ({ ...entity, start: { ...entity.start, x: value } }),
  startY: (entity, value) => ({ ...entity, start: { ...entity.start, y: value } }),
  endX: (entity, value) => ({ ...entity, end: { ...entity.end, x: value } }),
  endY: (entity, value) => ({ ...entity, end: { ...entity.end, y: value } }),
  length: (entity, value) => ({
    ...entity,
    end: endFromPolar(entity.start, value, lineAngleRad(entity)),
  }),
  angle: (entity, value) => ({
    ...entity,
    end: endFromPolar(entity.start, lineLengthMm(entity), value * DEG_TO_RAD),
  }),
};

const ARC_EDITS: EditTable<ArcEntity> = {
  centerX: (entity, value) => ({ ...entity, center: { ...entity.center, x: value } }),
  centerY: (entity, value) => ({ ...entity, center: { ...entity.center, y: value } }),
  radius: (entity, value) => ({ ...entity, radiusMm: value }),
  startAngle: (entity, value) => ({ ...entity, startAngleDeg: value }),
  sweep: (entity, value) => ({ ...entity, sweepDeg: value }),
  arcLength: (entity, value) => radiusFromArcLength(entity, value),
};

const PATH_EDITS: EditTable<PathEntity> = {
  x: (entity, value) => translatePathAxis(entity, 'x', value),
  y: (entity, value) => translatePathAxis(entity, 'y', value),
};

// Returns the edited entity, or null when the key does not apply to this shape or
// the value is unusable. Null means "ignore this edit", never an error to report.
export function applyEntityField(
  entity: SketchEntity,
  key: MeasurementKey,
  value: number,
): SketchEntity | null {
  if (!Number.isFinite(value)) return null;
  const edited = runEdit(entity, key, value);
  return edited === null ? null : sanitizeEntity(edited);
}

function runEdit(entity: SketchEntity, key: MeasurementKey, value: number): SketchEntity | null {
  switch (entity.kind) {
    case 'rect':
      return pickEdit(RECT_EDITS, key, entity, value);
    case 'circle':
      return pickEdit(CIRCLE_EDITS, key, entity, value);
    case 'line':
      return pickEdit(LINE_EDITS, key, entity, value);
    case 'arc':
      return pickEdit(ARC_EDITS, key, entity, value);
    case 'path':
      return pickEdit(PATH_EDITS, key, entity, value);
  }
}

// Keeps the dispatch switch at one branch per shape rather than one branch per
// shape plus two per lookup, which is what pushed it over the complexity cap.
function pickEdit<E>(
  table: EditTable<E>,
  key: MeasurementKey,
  entity: E,
  value: number,
): SketchEntity | null {
  const edit = table[key];
  return edit === undefined ? null : edit(entity, value);
}

function lineAngleRad(entity: LineEntity): number {
  return Math.atan2(entity.end.y - entity.start.y, entity.end.x - entity.start.x);
}

function lineLengthMm(entity: LineEntity): number {
  return Math.hypot(entity.end.x - entity.start.x, entity.end.y - entity.start.y);
}

function endFromPolar(start: Vec2, lengthMm: number, angleRad: number): Vec2 {
  return {
    x: start.x + Math.cos(angleRad) * lengthMm,
    y: start.y + Math.sin(angleRad) * lengthMm,
  };
}

function radiusFromArcLength(entity: ArcEntity, arcLengthMm: number): SketchEntity | null {
  const sweepRad = Math.abs(entity.sweepDeg) * DEG_TO_RAD;
  if (sweepRad <= 0) return null;
  return { ...entity, radiusMm: arcLengthMm / sweepRad };
}

// Typing a path's bounds origin translates every point, which is what "move this to
// X = 40" means for geometry with no parametric handles.
function translatePathAxis(
  entity: PathEntity,
  axis: 'x' | 'y',
  value: number,
): SketchEntity | null {
  const values = entity.points.map((point) => point[axis]);
  if (values.length === 0) return null;
  const delta = value - Math.min(...values);
  return {
    ...entity,
    points: entity.points.map((point) =>
      axis === 'x' ? { ...point, x: point.x + delta } : { ...point, y: point.y + delta },
    ),
  };
}
