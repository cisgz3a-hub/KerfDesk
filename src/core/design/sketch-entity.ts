// sketch-entity — the discriminated union the Design Studio draws, edits, and
// materializes (ADR-272, Phase N DS-1). Deliberately separate from ShapeSpec:
// a ShapeSpec is one finished object's parametric block, while a Sketch is a
// working set of independent entities that only becomes objects at Apply.
//
// Angles are stored in degrees because that is what the operator types and what
// serializes readably; radians appear only inside geometry helpers. Arc sweep is
// signed with positive = counter-clockwise, matching `sampleArcPoints` in
// core/geometry so the two never disagree about direction.
//
// Entity ids are supplied by the caller. Pure core may not generate them
// (no Math.random, no clock) — the UI owns identity.

import type { Vec2 } from '../scene';
import type { DesignLayer } from './layers/design-layer';

export type SketchEntityBase = {
  readonly id: string;
  // Construction geometry: drawn as a guide, never materialized into output.
  // LightBurn models the same idea as a non-output "tool" layer (T1), and our
  // Layer.output flag is where an applied construction entity would land.
  readonly construction?: boolean;
  // The carve layer this entity belongs to (ADR-272 Amendment 1). Absent or
  // unknown means the sketch's first layer, so pre-layer sketches keep working.
  readonly layerId?: string;
};

export type SketchLine = SketchEntityBase & {
  readonly kind: 'line';
  readonly start: Vec2;
  readonly end: Vec2;
};

export type SketchArc = SketchEntityBase & {
  readonly kind: 'arc';
  readonly center: Vec2;
  readonly radiusMm: number;
  readonly startAngleDeg: number;
  // Signed sweep; positive = counter-clockwise. |sweep| may exceed 360 only
  // after sanitization clamps it (see sanitizeEntity).
  readonly sweepDeg: number;
};

export type SketchCircle = SketchEntityBase & {
  readonly kind: 'circle';
  readonly center: Vec2;
  readonly radiusMm: number;
};

export type SketchRectangle = SketchEntityBase & {
  readonly kind: 'rect';
  // Minimum-x / minimum-y corner in sketch millimetres.
  readonly origin: Vec2;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly cornerRadiusMm: number;
};

export type SketchPath = SketchEntityBase & {
  readonly kind: 'path';
  readonly points: ReadonlyArray<Vec2>;
  readonly closed: boolean;
};

export type SketchEntity = SketchLine | SketchArc | SketchCircle | SketchRectangle | SketchPath;

export type SketchEntityKind = SketchEntity['kind'];

export type Sketch = {
  readonly entities: ReadonlyArray<SketchEntity>;
  // Carve layers (ADR-272 Amendment 1). Absent or empty behaves as exactly the
  // default layer; the field materializes on the first layer edit so sketches
  // built before layers existed stay valid.
  readonly layers?: ReadonlyArray<DesignLayer>;
};

export const EMPTY_SKETCH: Sketch = { entities: [] };

// Smallest entity the Studio will keep. Below this a drag is a click, not a
// draw — the same threshold idea as MIN_DRAW_SIZE_MM in core/shapes.
export const MIN_ENTITY_SIZE_MM = 0.01;

export const FULL_TURN_DEG = 360;

export function isFiniteVec2(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_ENTITY_SIZE_MM;
}

// Returns a usable entity, or null when the entity is degenerate. Null is the
// pure-core "nothing to draw" answer; it is never an error condition and never
// blocks anything (ADR-272 clause 9).
export function sanitizeEntity(entity: SketchEntity): SketchEntity | null {
  switch (entity.kind) {
    case 'line':
      return sanitizeLine(entity);
    case 'arc':
      return sanitizeArc(entity);
    case 'circle':
      return sanitizeCircle(entity);
    case 'rect':
      return sanitizeRectangle(entity);
    case 'path':
      return sanitizePath(entity);
  }
}

function sanitizeLine(entity: SketchLine): SketchLine | null {
  if (!isFiniteVec2(entity.start) || !isFiniteVec2(entity.end)) return null;
  const dx = entity.end.x - entity.start.x;
  const dy = entity.end.y - entity.start.y;
  return Math.hypot(dx, dy) >= MIN_ENTITY_SIZE_MM ? entity : null;
}

function sanitizeArc(entity: SketchArc): SketchArc | null {
  if (!isFiniteVec2(entity.center) || !isPositive(entity.radiusMm)) return null;
  if (!Number.isFinite(entity.startAngleDeg) || !Number.isFinite(entity.sweepDeg)) return null;
  const magnitude = Math.min(Math.abs(entity.sweepDeg), FULL_TURN_DEG);
  if (magnitude < MIN_ENTITY_SIZE_MM) return null;
  const sweepDeg = entity.sweepDeg < 0 ? -magnitude : magnitude;
  return { ...entity, sweepDeg };
}

function sanitizeCircle(entity: SketchCircle): SketchCircle | null {
  if (!isFiniteVec2(entity.center) || !isPositive(entity.radiusMm)) return null;
  return entity;
}

function sanitizeRectangle(entity: SketchRectangle): SketchRectangle | null {
  if (!isFiniteVec2(entity.origin)) return null;
  if (!isPositive(entity.widthMm) || !isPositive(entity.heightMm)) return null;
  if (!Number.isFinite(entity.cornerRadiusMm) || entity.cornerRadiusMm < 0) return null;
  // Clamped like RectangleSpec: a square at radius = side / 2 becomes a
  // stadium rather than self-intersecting.
  const cornerRadiusMm = Math.min(entity.cornerRadiusMm, entity.widthMm / 2, entity.heightMm / 2);
  return { ...entity, cornerRadiusMm };
}

function sanitizePath(entity: SketchPath): SketchPath | null {
  const points = entity.points.filter(isFiniteVec2);
  if (points.length < 2) return null;
  return { ...entity, points };
}
