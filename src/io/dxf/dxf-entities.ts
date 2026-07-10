// DXF entity → Polyline converters (Phase H.6). Every converter takes the
// entity's own tag run plus the drawing→mm scale and returns geometry in
// millimeters, still in DXF's Y-up frame — parse-dxf flips and normalizes
// once at the end. Z coordinates (codes 30/38) are deliberately ignored:
// this is a 2.5D import (F-CNC9 edge 4).

import type { Polyline, Vec2 } from '../../core/scene';
import type { DxfTag } from './dxf-tags';
import {
  bulgeSegment,
  isFullEllipseSweep,
  sampleArc,
  sampleCircle,
  sampleEllipse,
} from './dxf-curve-sampling';
import { sampleSpline } from './dxf-spline';

const DEGREES_TO_RADIANS = Math.PI / 180;
const FULL_TURN = Math.PI * 2;
const CLOSED_FLAG_BIT = 1;
const POLYLINE_MESH_FLAG_BITS = 16 | 64; // polygon/polyface meshes — 3D, skipped
const MIN_POLYLINE_POINTS = 2;

export type EntityConversion =
  | { readonly kind: 'ok'; readonly polyline: Polyline }
  | { readonly kind: 'skip'; readonly reason?: string };

const SKIP: EntityConversion = { kind: 'skip' };

export function lineToPolyline(tags: ReadonlyArray<DxfTag>, scale: number): EntityConversion {
  const start: Vec2 = { x: firstNumber(tags, 10) * scale, y: firstNumber(tags, 20) * scale };
  const end: Vec2 = { x: firstNumber(tags, 11) * scale, y: firstNumber(tags, 21) * scale };
  if (start.x === end.x && start.y === end.y) return SKIP;
  return { kind: 'ok', polyline: { points: [start, end], closed: false } };
}

export function circleToPolyline(tags: ReadonlyArray<DxfTag>, scale: number): EntityConversion {
  const radius = firstNumber(tags, 40) * scale;
  if (!(radius > 0)) return SKIP;
  const center: Vec2 = { x: firstNumber(tags, 10) * scale, y: firstNumber(tags, 20) * scale };
  return { kind: 'ok', polyline: { points: sampleCircle(center, radius), closed: true } };
}

export function arcToPolyline(tags: ReadonlyArray<DxfTag>, scale: number): EntityConversion {
  const radius = firstNumber(tags, 40) * scale;
  if (!(radius > 0)) return SKIP;
  const center: Vec2 = { x: firstNumber(tags, 10) * scale, y: firstNumber(tags, 20) * scale };
  const startRad = firstNumber(tags, 50) * DEGREES_TO_RADIANS;
  const endRad = firstNumber(tags, 51) * DEGREES_TO_RADIANS;
  // DXF arcs always run counter-clockwise from start to end.
  let sweep = endRad - startRad;
  while (sweep <= 0) sweep += FULL_TURN;
  return {
    kind: 'ok',
    polyline: { points: sampleArc(center, radius, startRad, sweep), closed: false },
  };
}

type BulgeVertex = { x: number; y: number; bulge: number };

export function lwpolylineToPolyline(tags: ReadonlyArray<DxfTag>, scale: number): EntityConversion {
  const vertices: BulgeVertex[] = [];
  for (const tag of tags) {
    if (tag.code === 10) vertices.push({ x: parseNumber(tag.value) * scale, y: 0, bulge: 0 });
    else if (tag.code === 20 && vertices.length > 0) {
      (vertices[vertices.length - 1] as BulgeVertex).y = parseNumber(tag.value) * scale;
    } else if (tag.code === 42 && vertices.length > 0) {
      (vertices[vertices.length - 1] as BulgeVertex).bulge = parseNumber(tag.value);
    }
  }
  const closed = (Math.trunc(firstNumber(tags, 70)) & CLOSED_FLAG_BIT) !== 0;
  return bulgeVerticesToPolyline(vertices, closed);
}

// Classic POLYLINE: the header entity's flags plus its VERTEX children
// (grouped by the section walker, which consumes through SEQEND).
export function polylineEntityToPolyline(
  headerTags: ReadonlyArray<DxfTag>,
  vertexTagRuns: ReadonlyArray<ReadonlyArray<DxfTag>>,
  scale: number,
): EntityConversion {
  const flags = Math.trunc(firstNumber(headerTags, 70));
  if ((flags & POLYLINE_MESH_FLAG_BITS) !== 0) {
    return { kind: 'skip', reason: 'polyface/polygon mesh POLYLINE' };
  }
  const vertices: BulgeVertex[] = vertexTagRuns.map((tags) => ({
    x: firstNumber(tags, 10) * scale,
    y: firstNumber(tags, 20) * scale,
    bulge: firstNumber(tags, 42),
  }));
  const closed = (flags & CLOSED_FLAG_BIT) !== 0;
  return bulgeVerticesToPolyline(vertices, closed);
}

export function ellipseToPolyline(tags: ReadonlyArray<DxfTag>, scale: number): EntityConversion {
  const center: Vec2 = { x: firstNumber(tags, 10) * scale, y: firstNumber(tags, 20) * scale };
  const majorAxis: Vec2 = { x: firstNumber(tags, 11) * scale, y: firstNumber(tags, 21) * scale };
  const ratio = firstNumber(tags, 40);
  if (!(Math.hypot(majorAxis.x, majorAxis.y) > 0) || !(ratio > 0)) return SKIP;
  const startParam = firstNumber(tags, 41);
  const endParam = firstNumber(tags, 42, FULL_TURN);
  const points = sampleEllipse(center, majorAxis, ratio, startParam, endParam);
  if (isFullEllipseSweep(startParam, endParam)) {
    points.pop(); // drop the seam duplicate; `closed` joins it
    return { kind: 'ok', polyline: { points, closed: true } };
  }
  return { kind: 'ok', polyline: { points, closed: false } };
}

export function splineToPolyline(tags: ReadonlyArray<DxfTag>, scale: number): EntityConversion {
  const flags = Math.trunc(firstNumber(tags, 70));
  const controlPoints: Vec2[] = [];
  for (const tag of tags) {
    if (tag.code === 10) controlPoints.push({ x: parseNumber(tag.value) * scale, y: 0 });
    else if (tag.code === 20 && controlPoints.length > 0) {
      const last = controlPoints.length - 1;
      controlPoints[last] = {
        x: (controlPoints[last] as Vec2).x,
        y: parseNumber(tag.value) * scale,
      };
    }
  }
  const result = sampleSpline({
    degree: Math.trunc(firstNumber(tags, 71, 3)),
    knots: allNumbers(tags, 40),
    controlPoints,
    weights: allNumbers(tags, 41),
    closed: (flags & CLOSED_FLAG_BIT) !== 0,
  });
  if (result.kind === 'error') return { kind: 'skip', reason: `SPLINE: ${result.reason}` };
  const closed = (flags & CLOSED_FLAG_BIT) !== 0;
  const points = [...result.points];
  if (
    closed &&
    points.length > 1 &&
    samePoint(points[0] as Vec2, points[points.length - 1] as Vec2)
  ) {
    points.pop();
  }
  if (points.length < MIN_POLYLINE_POINTS) return SKIP;
  return { kind: 'ok', polyline: { points, closed } };
}

function bulgeVerticesToPolyline(
  vertices: ReadonlyArray<BulgeVertex>,
  closed: boolean,
): EntityConversion {
  if (vertices.length < MIN_POLYLINE_POINTS) return SKIP;
  const first = vertices[0] as BulgeVertex;
  const points: Vec2[] = [{ x: first.x, y: first.y }];
  const segmentCount = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < segmentCount; i += 1) {
    const from = vertices[i] as BulgeVertex;
    const to = vertices[(i + 1) % vertices.length] as BulgeVertex;
    points.push(...bulgeSegment({ x: from.x, y: from.y }, { x: to.x, y: to.y }, from.bulge));
  }
  // A closed run ends back on the first vertex; drop the seam duplicate.
  if (closed && points.length > 1) points.pop();
  if (points.length < MIN_POLYLINE_POINTS) return SKIP;
  return { kind: 'ok', polyline: { points, closed } };
}

export function firstNumber(tags: ReadonlyArray<DxfTag>, code: number, fallback = 0): number {
  const tag = tags.find((candidate) => candidate.code === code);
  return tag === undefined ? fallback : parseNumber(tag.value, fallback);
}

export function firstString(tags: ReadonlyArray<DxfTag>, code: number): string | null {
  const tag = tags.find((candidate) => candidate.code === code);
  return tag?.value ?? null;
}

export function allNumbers(tags: ReadonlyArray<DxfTag>, code: number): ReadonlyArray<number> {
  return tags
    .filter((tag) => tag.code === code)
    .map((tag) => parseNumber(tag.value))
    .filter((value) => Number.isFinite(value));
}

function parseNumber(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Group codes that carry geometry the converters actually read: point/vertex
// coords (10/20, 11/21), radius/ratio/params/bulge (40/41/42), and angles
// (50/51). Z (30/31/38) is deliberately absent — this is a 2.5D import that
// ignores Z, so a corrupt Z is harmless. Non-geometry codes (layer 8, color 62,
// flags 70, …) stay tolerant so ordinary files are unaffected.
const DXF_GEOMETRY_CODES: ReadonlySet<number> = new Set([10, 20, 11, 21, 40, 41, 42, 50, 51]);
// Codes that are scaled lengths in machine mm — the magnitude cap applies to
// these (after scale). Angles/ratios/params/bulge (41/42/50/51) are not lengths.
const DXF_SCALED_LENGTH_CODES: ReadonlySet<number> = new Set([10, 20, 11, 21, 40]);
// Mirror SVG's coordinate cap (SVG_IMPORT_LIMITS.coordinateMagnitudeMm): a
// finite-but-astronomical coordinate would only fault later at bed-bounds
// preflight, so reject the entity at the import boundary like SVG does.
export const DXF_COORDINATE_MAGNITUDE_MM = 1_000_000;

// True if any geometry-bearing tag holds a value the converters would silently
// coerce to 0 (non-numeric) or an out-of-range magnitude — i.e. the entity
// should be skipped and reported rather than imported as corrupt geometry.
export function hasUnreadableGeometry(tags: ReadonlyArray<DxfTag>, scale: number): boolean {
  for (const tag of tags) {
    if (!DXF_GEOMETRY_CODES.has(tag.code)) continue;
    const value = Number.parseFloat(tag.value);
    if (!Number.isFinite(value)) return true;
    if (DXF_SCALED_LENGTH_CODES.has(tag.code) && Math.abs(value * scale) > DXF_COORDINATE_MAGNITUDE_MM) {
      return true;
    }
  }
  return false;
}

function samePoint(a: Vec2, b: Vec2): boolean {
  const EPSILON = 1e-9;
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}
