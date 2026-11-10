// sketch-dimension — a dimension that belongs to the drawing (ADR-272
// Amendment 7, Phase N DS-7).
//
// Clause 5 of ADR-272 replaces a constraint solver with dimension-driven
// editing: a DRIVING dimension owns the one quantity it measures and re-solves
// its own geometry locally when its value changes; a DRIVEN dimension is a
// reference that only reports (Fusion and Onshape's distinction, drawn in
// parentheses as they draw it). Nothing propagates: a dimension moves the
// geometry it names and nothing connected to it, which is the stated cost of
// having no solver.
//
// The kind is inferred from what was picked (the unified Dimension tool of
// Fusion and Onshape): a line gives its length, a polyline segment its length,
// a rectangle edge its width or height, a circle its diameter, an arc its
// radius, and two lines the angle between them.

import type { Sketch, SketchEntity } from '../sketch-entity';

export type DimensionKind =
  | 'line-length'
  | 'segment-length'
  | 'rect-width'
  | 'rect-height'
  | 'diameter'
  | 'radius'
  | 'angle';

export type SketchDimension = {
  readonly id: string;
  readonly kind: DimensionKind;
  readonly entityId: string;
  // Which polyline segment, for 'segment-length' (segment i runs from point i
  // to point i + 1; the closing segment of a closed path is the last index).
  readonly segmentIndex?: number;
  // The second line, for 'angle'.
  readonly otherEntityId?: string;
  readonly driving: boolean;
  // The value a driving dimension holds, in millimetres (degrees for an angle).
  // Absent on a driven dimension, which reads the geometry instead.
  readonly value?: number;
};

export const DIMENSION_KINDS: ReadonlySet<DimensionKind> = new Set([
  'line-length',
  'segment-length',
  'rect-width',
  'rect-height',
  'diameter',
  'radius',
  'angle',
]);

export function sketchDimensions(sketch: Sketch): ReadonlyArray<SketchDimension> {
  return sketch.dimensions ?? [];
}

export function isAngular(kind: DimensionKind): boolean {
  return kind === 'angle';
}

/** The entities a dimension reads, in order. */
export function dimensionEntityIds(dimension: SketchDimension): ReadonlyArray<string> {
  return dimension.otherEntityId === undefined
    ? [dimension.entityId]
    : [dimension.entityId, dimension.otherEntityId];
}

export function findSketchEntity(sketch: Sketch, id: string): SketchEntity | null {
  return sketch.entities.find((entity) => entity.id === id) ?? null;
}

const MAX_DIMENSIONS = 2000;

/**
 * Keeps only well-formed dimensions. A stored sketch (browser storage, a
 * project file) is untrusted input: a malformed record is dropped rather than
 * allowed to reach the solver.
 */
export function sanitizeDimensions(sketch: Sketch): Sketch {
  const raw: unknown = sketch.dimensions;
  if (raw === undefined) return sketch;
  if (!Array.isArray(raw)) return withDimensions(sketch, []);
  const kept = (raw as unknown[]).filter(isWellFormedDimension).slice(0, MAX_DIMENSIONS);
  return kept.length === raw.length ? sketch : withDimensions(sketch, kept);
}

export function isWellFormedDimension(value: unknown): value is SketchDimension {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record['id'] !== 'string' || typeof record['entityId'] !== 'string') return false;
  if (!DIMENSION_KINDS.has(record['kind'] as DimensionKind)) return false;
  return typeof record['driving'] === 'boolean' && wellFormedOptionals(record);
}

function wellFormedOptionals(record: Record<string, unknown>): boolean {
  const segment = record['segmentIndex'];
  if (segment !== undefined && !(Number.isInteger(segment) && (segment as number) >= 0)) {
    return false;
  }
  const other = record['otherEntityId'];
  if (other !== undefined && typeof other !== 'string') return false;
  // An angle names exactly two lines; nothing else names a second entity.
  if ((record['kind'] === 'angle') !== (other !== undefined)) return false;
  const reading = record['value'];
  return reading === undefined || (typeof reading === 'number' && Number.isFinite(reading));
}

/** The sketch with its dimension list replaced, dropping the field when empty. */
export function withDimensions(sketch: Sketch, dimensions: ReadonlyArray<SketchDimension>): Sketch {
  if (dimensions.length > 0) return { ...sketch, dimensions };
  if (sketch.dimensions === undefined) return sketch;
  return sketch.layers === undefined
    ? { entities: sketch.entities }
    : { entities: sketch.entities, layers: sketch.layers };
}
