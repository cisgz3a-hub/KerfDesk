// entity-geometry — materializes a sketch entity into the Polyline form the
// rest of the pipeline already understands (ADR-272, Phase N DS-1).
//
// Arc sampling and rounded-rectangle walking are NOT reimplemented here: both
// come from the existing core modules so the Design Studio cannot drift from
// the tolerance the importer and the .nc parser already agree on
// (ARC_CHORD_TOLERANCE_MM). The research pass found tolerances scattered across
// layers; this module deliberately adds none of its own.

import { sampleArcPoints } from '../geometry';
import { ellipseToPolylines, rectangleToPolylines } from '../shapes/primitives';
import type { Polyline, Vec2 } from '../scene';
import {
  sanitizeEntity,
  type SketchArc,
  type SketchCircle,
  type SketchEllipse,
  type SketchEntity,
  type SketchPath,
  type SketchRectangle,
} from './sketch-entity';

const DEG_TO_RAD = Math.PI / 180;
const FULL_TURN_RAD = Math.PI * 2;
// Two sampled points closer than this are the same point for closure purposes.
const CLOSURE_EPSILON_MM = 1e-9;

// A degenerate entity materializes to nothing rather than to a broken polyline.
// Callers treat an empty array as "not drawable yet", never as a failure.
export function entityToPolylines(entity: SketchEntity): ReadonlyArray<Polyline> {
  const clean = sanitizeEntity(entity);
  if (clean === null) return [];
  switch (clean.kind) {
    case 'line':
      return [{ points: [clean.start, clean.end], closed: false }];
    case 'arc':
      return [arcPolyline(clean)];
    case 'circle':
      return [circlePolyline(clean)];
    case 'ellipse':
      return [ellipsePolyline(clean)];
    case 'rect':
      return rectanglePolylines(clean);
    case 'path':
      return [pathPolyline(clean)];
  }
}

function arcPolyline(entity: SketchArc): Polyline {
  const points = sampleArcPoints(
    entity.center,
    entity.radiusMm,
    entity.startAngleDeg * DEG_TO_RAD,
    entity.sweepDeg * DEG_TO_RAD,
  );
  return { points, closed: false };
}

function circlePolyline(entity: SketchCircle): Polyline {
  const sampled = sampleArcPoints(entity.center, entity.radiusMm, 0, FULL_TURN_RAD);
  return { points: withoutClosingDuplicate(sampled), closed: true };
}

// ellipseToPolylines inscribes the outline in the local box [0,w] x [0,h] and
// repeats the first point for renderers that never close a path; the sketch
// places it by its centre and carries closure in the flag, so both are undone
// here rather than re-deriving the sampler's adaptive segment count.
function ellipsePolyline(entity: SketchEllipse): Polyline {
  const local = ellipseToPolylines({
    widthMm: entity.radiusXMm * 2,
    heightMm: entity.radiusYMm * 2,
  })[0];
  if (local === undefined) return { points: [], closed: true };
  const offset: Vec2 = {
    x: entity.center.x - entity.radiusXMm,
    y: entity.center.y - entity.radiusYMm,
  };
  return {
    points: withoutClosingDuplicate(local.points).map((point) => translate(point, offset)),
    closed: true,
  };
}

function rectanglePolylines(entity: SketchRectangle): ReadonlyArray<Polyline> {
  // rectangleToPolylines works in local shape space with the minimum corner at
  // the origin; the sketch places it, so translate rather than re-derive.
  const local = rectangleToPolylines({
    widthMm: entity.widthMm,
    heightMm: entity.heightMm,
    cornerRadiusMm: entity.cornerRadiusMm,
  });
  return local.map((polyline) => ({
    ...polyline,
    points: polyline.points.map((point) => translate(point, entity.origin)),
  }));
}

function pathPolyline(entity: SketchPath): Polyline {
  const points = entity.closed ? withoutClosingDuplicate(entity.points) : entity.points;
  return { points, closed: entity.closed };
}

function translate(point: Vec2, offset: Vec2): Vec2 {
  return { x: point.x + offset.x, y: point.y + offset.y };
}

// A closed Polyline carries closure in its flag, not in a repeated last point.
// sampleArcPoints includes both endpoints, so a full turn would otherwise leave
// a zero-length closing segment that every downstream length/area calculation
// then has to tolerate.
function withoutClosingDuplicate(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return points;
  const isDuplicate =
    Math.abs(first.x - last.x) < CLOSURE_EPSILON_MM &&
    Math.abs(first.y - last.y) < CLOSURE_EPSILON_MM;
  return isDuplicate ? points.slice(0, -1) : points;
}
