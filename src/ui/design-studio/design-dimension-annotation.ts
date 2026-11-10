// design-dimension-annotation — how a placed dimension is drawn and picked
// (ADR-272 Amendment 7, DS-7).
//
// A placed dimension reuses the DS-3b call-out geometry (DimensionAnnotation)
// and painter, so a dimension the operator placed and the call-out the
// inspector shows look like one family. Driven (reference) dimensions read in
// parentheses, as Fusion and Onshape draw them.

import type { Sketch, SketchEntity } from '../../core/design';
import {
  lineAngle,
  measureDimension,
  sketchDimensions,
  type SketchDimension,
} from '../../core/design/dimensions';
import { distanceToSegment } from './design-hit-test';
import type { Vec2 } from '../../core/scene';
import { addPoints } from '../../core/geometry/point-math';
import type { DimensionAnnotation } from './design-measure-annotation';

export type PlacedDimension = {
  readonly id: string;
  readonly annotation: DimensionAnnotation;
  readonly label: string;
};

// Placed dimensions stand a little further off than the transient call-out so
// the two never sit on top of each other.
const OFFSET_MM = 8;
const MIN_ANGLE_RADIUS_MM = 4;
const ANGLE_RADIUS_FRACTION = 0.45;
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const FULL_TURN_DEG = 360;

export function placedDimensions(sketch: Sketch): ReadonlyArray<PlacedDimension> {
  return sketchDimensions(sketch).flatMap((dimension) => {
    const placed = placeDimension(sketch, dimension);
    return placed === null ? [] : [placed];
  });
}

export function placeDimension(sketch: Sketch, dimension: SketchDimension): PlacedDimension | null {
  const reading = measureDimension(sketch, dimension);
  const annotation = annotationOf(sketch, dimension);
  if (reading === null || annotation === null) return null;
  return { id: dimension.id, annotation, label: dimensionLabel(dimension, reading) };
}

export function dimensionLabel(dimension: SketchDimension, reading: number): string {
  const text =
    dimension.kind === 'angle'
      ? `${reading.toFixed(1)}°`
      : `${dimension.kind === 'radius' ? 'R' : dimension.kind === 'diameter' ? '⌀' : ''}${reading.toFixed(2)} mm`;
  return dimension.driving ? text : `(${text})`;
}

export function dimensionKindLabel(dimension: SketchDimension): string {
  switch (dimension.kind) {
    case 'line-length':
    case 'segment-length':
      return 'Length';
    case 'rect-width':
      return 'Width';
    case 'rect-height':
      return 'Height';
    case 'diameter':
      return 'Diameter';
    case 'radius':
      return 'Radius';
    case 'angle':
      return 'Angle';
  }
}

/** The placed dimension whose drawn line is nearest `pointMm`, within `toleranceMm`. */
export function dimensionAtPoint(
  sketch: Sketch,
  pointMm: Vec2,
  toleranceMm: number,
): string | null {
  let best: string | null = null;
  let bestDistance = toleranceMm;
  for (const placed of placedDimensions(sketch)) {
    const distance = annotationDistance(placed.annotation, pointMm);
    if (distance <= bestDistance) {
      best = placed.id;
      bestDistance = distance;
    }
  }
  return best;
}

function annotationDistance(annotation: DimensionAnnotation, point: Vec2): number {
  switch (annotation.kind) {
    case 'linear': {
      const from = addPoints(annotation.fromMm, annotation.offsetMm);
      const to = addPoints(annotation.toMm, annotation.offsetMm);
      return distanceToSegment(point, from, to);
    }
    case 'radial':
      return distanceToSegment(point, annotation.centreMm, annotation.edgeMm);
    case 'angular': {
      const angle =
        Math.atan2(point.y - annotation.centreMm.y, point.x - annotation.centreMm.x) * RAD_TO_DEG;
      const sign = annotation.sweepDeg < 0 ? -1 : 1;
      const progress = modulo(sign * (angle - annotation.startDeg));
      if (progress > Math.abs(annotation.sweepDeg)) return Infinity;
      const reach = Math.hypot(point.x - annotation.centreMm.x, point.y - annotation.centreMm.y);
      return Math.abs(reach - annotation.radiusMm);
    }
    case 'point':
      return Math.hypot(point.x - annotation.atMm.x, point.y - annotation.atMm.y);
  }
}

function annotationOf(sketch: Sketch, dimension: SketchDimension): DimensionAnnotation | null {
  const entity = sketch.entities.find((candidate) => candidate.id === dimension.entityId);
  if (entity === undefined) return null;
  if (dimension.kind === 'angle') return angleAnnotation(sketch, dimension);
  switch (entity.kind) {
    case 'line':
      return alongside(entity.start, entity.end);
    case 'path':
      return segmentAnnotation(entity, dimension.segmentIndex ?? 0);
    case 'rect':
      return rectAnnotation(entity, dimension.kind === 'rect-width');
    case 'circle':
    case 'arc':
      return roundAnnotation(entity, dimension.kind === 'diameter');
    case 'ellipse':
      return null;
  }
}

function segmentAnnotation(
  path: Extract<SketchEntity, { readonly kind: 'path' }>,
  index: number,
): DimensionAnnotation | null {
  const from = path.points[index];
  const to = path.points[(index + 1) % path.points.length];
  return from === undefined || to === undefined ? null : alongside(from, to);
}

function rectAnnotation(
  rect: Extract<SketchEntity, { readonly kind: 'rect' }>,
  width: boolean,
): DimensionAnnotation {
  const { x, y } = rect.origin;
  const right = x + rect.widthMm;
  const top = y + rect.heightMm;
  return width
    ? {
        kind: 'linear',
        fromMm: { x, y: top },
        toMm: { x: right, y: top },
        offsetMm: { x: 0, y: OFFSET_MM },
      }
    : {
        kind: 'linear',
        fromMm: { x: right, y },
        toMm: { x: right, y: top },
        offsetMm: { x: OFFSET_MM, y: 0 },
      };
}

function roundAnnotation(
  entity: Extract<SketchEntity, { readonly kind: 'circle' | 'arc' }>,
  diameter: boolean,
): DimensionAnnotation {
  const { center, radiusMm } = entity;
  if (diameter) {
    return {
      kind: 'linear',
      fromMm: { x: center.x - radiusMm, y: center.y },
      toMm: { x: center.x + radiusMm, y: center.y },
      offsetMm: { x: 0, y: 0 },
    };
  }
  const midDeg = entity.kind === 'arc' ? entity.startAngleDeg + entity.sweepDeg / 2 : 45;
  return {
    kind: 'radial',
    centreMm: center,
    edgeMm: {
      x: center.x + Math.cos(midDeg * DEG_TO_RAD) * radiusMm,
      y: center.y + Math.sin(midDeg * DEG_TO_RAD) * radiusMm,
    },
  };
}

// A length dimension stands off the edge on its left-hand side.
function alongside(from: Vec2, to: Vec2): DimensionAnnotation {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return {
    kind: 'linear',
    fromMm: from,
    toMm: to,
    offsetMm: {
      x: (-(to.y - from.y) / length) * OFFSET_MM,
      y: ((to.x - from.x) / length) * OFFSET_MM,
    },
  };
}

function angleAnnotation(sketch: Sketch, dimension: SketchDimension): DimensionAnnotation | null {
  const angle = lineAngle(sketch, dimension);
  if (angle === null) return null;
  const { pivot, first, second } = angle;
  const away = (line: typeof first): Vec2 => {
    const far =
      Math.hypot(line.start.x - pivot.x, line.start.y - pivot.y) >
      Math.hypot(line.end.x - pivot.x, line.end.y - pivot.y)
        ? line.start
        : line.end;
    return { x: far.x - pivot.x, y: far.y - pivot.y };
  };
  const a = away(first);
  const b = away(second);
  const startDeg = Math.atan2(a.y, a.x) * RAD_TO_DEG;
  let sweepDeg = Math.atan2(b.y, b.x) * RAD_TO_DEG - startDeg;
  if (sweepDeg > 180) sweepDeg -= FULL_TURN_DEG;
  if (sweepDeg <= -180) sweepDeg += FULL_TURN_DEG;
  const reach = Math.min(Math.hypot(a.x, a.y), Math.hypot(b.x, b.y));
  return {
    kind: 'angular',
    centreMm: pivot,
    radiusMm: Math.max(MIN_ANGLE_RADIUS_MM, reach * ANGLE_RADIUS_FRACTION),
    startDeg,
    sweepDeg,
  };
}

function modulo(degrees: number): number {
  return ((degrees % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG;
}
