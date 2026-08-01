// design-measure-annotation — what a dimension field is pointing AT
// (ADR-272, DS-3b).
//
// Focusing "Width" in the inspector must show, on the shape, the exact distance
// that number controls: a dimension line spanning it, arrowheads at both ends,
// witness lines out to the geometry. That is the difference between a properties
// panel and a CAD inspector — Fusion and Onshape both make the dimension a visible
// object, not just a value in a box.
//
// Pure geometry in millimetres; the overlay renderer turns these into pixels and
// arrowheads. Keyed lookup tables rather than switches, because MeasurementKey is a
// wide union and each shape answers for only a few of its keys.

import type { SketchEntity } from '../../core/design';
import type { Vec2 } from '../../core/scene';
import type { ArcEntity } from './design-fields-arc';
import type { CircleEntity } from './design-fields-circle';
import type { LineEntity } from './design-fields-line';
import type { RectEntity } from './design-fields-rect';
import { DEG_TO_RAD, RAD_TO_DEG, type MeasurementKey } from './design-field-types';

export type DimensionAnnotation =
  // A measured distance between two points, drawn offset from the geometry by
  // `offsetMm` so the dimension line does not sit on top of the edge it measures.
  | {
      readonly kind: 'linear';
      readonly fromMm: Vec2;
      readonly toMm: Vec2;
      readonly offsetMm: Vec2;
    }
  // Centre-to-rim, for radius and corner radius.
  | { readonly kind: 'radial'; readonly centreMm: Vec2; readonly edgeMm: Vec2 }
  // A swept angle, for line angle and arc start/sweep.
  | {
      readonly kind: 'angular';
      readonly centreMm: Vec2;
      readonly radiusMm: number;
      readonly startDeg: number;
      readonly sweepDeg: number;
    }
  // A single called-out coordinate, for X/Y fields.
  | { readonly kind: 'point'; readonly atMm: Vec2 };

// Dimension lines stand this far off the edge they measure so they stay legible
// without colliding with the geometry.
const OFFSET_MM = 6;
const ANGLE_ARC_FRACTION = 0.45;
const MIN_ANGLE_RADIUS_MM = 4;

type Annotate<E> = (entity: E) => DimensionAnnotation | null;
type AnnotationTable<E> = Partial<Readonly<Record<MeasurementKey, Annotate<E>>>>;

const RECT_ANNOTATIONS: AnnotationTable<RectEntity> = {
  // Below the shape, spanning left edge to right edge.
  width: (entity) => ({
    kind: 'linear',
    fromMm: { x: entity.origin.x, y: entity.origin.y + entity.heightMm },
    toMm: { x: entity.origin.x + entity.widthMm, y: entity.origin.y + entity.heightMm },
    offsetMm: { x: 0, y: OFFSET_MM },
  }),
  // To the right of the shape, spanning top edge to bottom edge.
  height: (entity) => ({
    kind: 'linear',
    fromMm: { x: entity.origin.x + entity.widthMm, y: entity.origin.y },
    toMm: { x: entity.origin.x + entity.widthMm, y: entity.origin.y + entity.heightMm },
    offsetMm: { x: OFFSET_MM, y: 0 },
  }),
  // From the work origin across to the shape's left edge.
  x: (entity) => ({
    kind: 'linear',
    fromMm: { x: 0, y: entity.origin.y },
    toMm: entity.origin,
    offsetMm: { x: 0, y: -OFFSET_MM },
  }),
  y: (entity) => ({
    kind: 'linear',
    fromMm: { x: entity.origin.x, y: 0 },
    toMm: entity.origin,
    offsetMm: { x: -OFFSET_MM, y: 0 },
  }),
  cornerRadius: cornerRadiusAnnotation,
  perimeter: (entity) => ({
    kind: 'linear',
    fromMm: { x: entity.origin.x, y: entity.origin.y + entity.heightMm },
    toMm: { x: entity.origin.x + entity.widthMm, y: entity.origin.y + entity.heightMm },
    offsetMm: { x: 0, y: OFFSET_MM },
  }),
};

// Called out at the top-left corner: the centre of that corner's arc, out to the edge.
function cornerRadiusAnnotation(entity: RectEntity): DimensionAnnotation | null {
  const r = Math.min(entity.cornerRadiusMm, entity.widthMm / 2, entity.heightMm / 2);
  if (r <= 0) return null;
  const centre = { x: entity.origin.x + r, y: entity.origin.y + r };
  return { kind: 'radial', centreMm: centre, edgeMm: { x: entity.origin.x, y: centre.y } };
}

const acrossCircle: Annotate<CircleEntity> = (entity) => ({
  kind: 'linear',
  fromMm: { x: entity.center.x - entity.radiusMm, y: entity.center.y },
  toMm: { x: entity.center.x + entity.radiusMm, y: entity.center.y },
  offsetMm: { x: 0, y: 0 },
});

const CIRCLE_ANNOTATIONS: AnnotationTable<CircleEntity> = {
  radius: (entity) => ({
    kind: 'radial',
    centreMm: entity.center,
    edgeMm: { x: entity.center.x + entity.radiusMm, y: entity.center.y },
  }),
  diameter: acrossCircle,
  circumference: acrossCircle,
  area: acrossCircle,
  centerX: (entity) => ({
    kind: 'linear',
    fromMm: { x: 0, y: entity.center.y },
    toMm: entity.center,
    offsetMm: { x: 0, y: -OFFSET_MM },
  }),
  centerY: (entity) => ({
    kind: 'linear',
    fromMm: { x: entity.center.x, y: 0 },
    toMm: entity.center,
    offsetMm: { x: -OFFSET_MM, y: 0 },
  }),
};

const LINE_ANNOTATIONS: AnnotationTable<LineEntity> = {
  // Offset perpendicular to the line itself, so it reads as that line's length.
  length: (entity) => ({
    kind: 'linear',
    fromMm: entity.start,
    toMm: entity.end,
    offsetMm: perpendicularOffsetMm(entity.start, entity.end),
  }),
  angle: (entity) => ({
    kind: 'angular',
    centreMm: entity.start,
    radiusMm: Math.max(
      MIN_ANGLE_RADIUS_MM,
      Math.hypot(entity.end.x - entity.start.x, entity.end.y - entity.start.y) * ANGLE_ARC_FRACTION,
    ),
    startDeg: 0,
    sweepDeg: Math.atan2(entity.end.y - entity.start.y, entity.end.x - entity.start.x) * RAD_TO_DEG,
  }),
  startX: (entity) => ({ kind: 'point', atMm: entity.start }),
  startY: (entity) => ({ kind: 'point', atMm: entity.start }),
  endX: (entity) => ({ kind: 'point', atMm: entity.end }),
  endY: (entity) => ({ kind: 'point', atMm: entity.end }),
};

const radialToArcStart: Annotate<ArcEntity> = (entity) => ({
  kind: 'radial',
  centreMm: entity.center,
  edgeMm: pointOnArcMm(entity, 0),
});

const ARC_ANNOTATIONS: AnnotationTable<ArcEntity> = {
  radius: radialToArcStart,
  arcLength: radialToArcStart,
  startAngle: (entity) => ({
    kind: 'angular',
    centreMm: entity.center,
    radiusMm: Math.max(MIN_ANGLE_RADIUS_MM, entity.radiusMm * ANGLE_ARC_FRACTION),
    startDeg: 0,
    sweepDeg: entity.startAngleDeg,
  }),
  sweep: (entity) => ({
    kind: 'angular',
    centreMm: entity.center,
    radiusMm: Math.max(MIN_ANGLE_RADIUS_MM, entity.radiusMm * ANGLE_ARC_FRACTION),
    startDeg: entity.startAngleDeg,
    sweepDeg: entity.sweepDeg,
  }),
  chord: (entity) => ({
    kind: 'linear',
    fromMm: pointOnArcMm(entity, 0),
    toMm: pointOnArcMm(entity, 1),
    offsetMm: { x: 0, y: 0 },
  }),
  centerX: (entity) => ({ kind: 'point', atMm: entity.center }),
  centerY: (entity) => ({ kind: 'point', atMm: entity.center }),
};

export function annotationFor(
  entity: SketchEntity,
  key: MeasurementKey,
): DimensionAnnotation | null {
  switch (entity.kind) {
    case 'rect':
      return pickAnnotation(RECT_ANNOTATIONS, key, entity);
    case 'circle':
      return pickAnnotation(CIRCLE_ANNOTATIONS, key, entity);
    case 'line':
      return pickAnnotation(LINE_ANNOTATIONS, key, entity);
    case 'arc':
      return pickAnnotation(ARC_ANNOTATIONS, key, entity);
    case 'path':
      return null;
  }
}

// Keeps the dispatch switch at one branch per shape rather than three.
function pickAnnotation<E>(
  table: AnnotationTable<E>,
  key: MeasurementKey,
  entity: E,
): DimensionAnnotation | null {
  const annotate = table[key];
  return annotate === undefined ? null : annotate(entity);
}

function perpendicularOffsetMm(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 0, y: OFFSET_MM };
  return { x: (-dy / length) * OFFSET_MM, y: (dx / length) * OFFSET_MM };
}

// t = 0 at the arc start, t = 1 at its end.
function pointOnArcMm(entity: ArcEntity, t: number): Vec2 {
  const rad = (entity.startAngleDeg + entity.sweepDeg * t) * DEG_TO_RAD;
  return {
    x: entity.center.x + Math.cos(rad) * entity.radiusMm,
    y: entity.center.y + Math.sin(rad) * entity.radiusMm,
  };
}
