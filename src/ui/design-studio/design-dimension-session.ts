// design-dimension-session — the Dimension tool's session transitions
// (ADR-272 Amendment 7, DS-7).
//
// One click either picks an existing dimension (to edit it), or hands what is
// under the pointer to core inference: a line waits for a second pick, every
// other entity is dimensioned at once. A new dimension is driving at the
// geometry's current reading, so placing it moves nothing; typing a value then
// drives the geometry as one undo step.

import type { Sketch } from '../../core/design';
import {
  driveDimension,
  inferDimension,
  setDimensionDriving,
  sketchDimensions,
  withDimensions,
  type DimensionKind,
} from '../../core/design/dimensions';
import type { Vec2 } from '../../core/scene';
import { dimensionAtPoint } from './design-dimension-annotation';
import { hitTestSketch } from './design-hit-test';
import type { MeasurementKey } from './design-entity-fields';
import { sessionSketch, withSketch, type DesignSession } from './design-session';

export function dimensionSessionAt(
  session: DesignSession,
  atMm: Vec2,
  toleranceMm: number,
  newId: string,
): DesignSession {
  const sketch = sessionSketch(session);
  const pending = session.dimensionPendingLineId;
  const existing = pending === null ? dimensionAtPoint(sketch, atMm, toleranceMm) : null;
  if (existing !== null) return { ...session, activeDimensionId: existing };
  const hit = hitTestSketch(sketch, atMm, toleranceMm);
  const inference = inferDimension(
    sketch,
    hit === null ? null : { entityId: hit.id, atMm },
    pending,
  );
  if (inference.kind === 'pending') {
    return { ...session, dimensionPendingLineId: inference.lineId, activeDimensionId: null };
  }
  if (inference.kind === 'none') return { ...session, dimensionPendingLineId: null };
  const placed = withDimensions(sketch, [
    ...sketchDimensions(sketch),
    { id: newId, ...inference.dimension },
  ]);
  return {
    ...withSketch(session, placed),
    dimensionPendingLineId: null,
    activeDimensionId: newId,
  };
}

/** Types a value into a dimension: its geometry re-solves, as one undo step. */
export function driveSessionDimension(
  session: DesignSession,
  id: string,
  value: number,
): DesignSession {
  const sketch = sessionSketch(session);
  const dimension = sketchDimensions(sketch).find((candidate) => candidate.id === id);
  if (dimension === undefined) return session;
  const driven = driveDimension(sketch, dimension, value);
  return driven === null ? session : withSketch(session, driven);
}

export function setSessionDimensionDriving(
  session: DesignSession,
  id: string,
  driving: boolean,
): DesignSession {
  return withSketch(session, setDimensionDriving(sessionSketch(session), id, driving));
}

export function deleteSessionDimension(session: DesignSession, id: string): DesignSession {
  const sketch = sessionSketch(session);
  const kept = sketchDimensions(sketch).filter((dimension) => dimension.id !== id);
  return {
    ...withSketch(session, withDimensions(sketch, kept)),
    activeDimensionId: session.activeDimensionId === id ? null : session.activeDimensionId,
  };
}

// Inspector fields that a driving dimension owns. Typing one of them drives the
// dimension instead, so the typed value sticks and the dimension reads it.
const FIELD_DIMENSIONS: ReadonlyArray<{
  readonly key: MeasurementKey;
  readonly kind: DimensionKind;
  readonly scale: number;
}> = [
  { key: 'length', kind: 'line-length', scale: 1 },
  { key: 'width', kind: 'rect-width', scale: 1 },
  { key: 'height', kind: 'rect-height', scale: 1 },
  { key: 'diameter', kind: 'diameter', scale: 1 },
  { key: 'radius', kind: 'diameter', scale: 2 },
  { key: 'radius', kind: 'radius', scale: 1 },
];

/**
 * The session after an inspector field edit that a driving dimension owns, or
 * null when no driving dimension owns that field (the ordinary edit applies).
 */
export function fieldEditThroughDimension(
  session: DesignSession,
  entityId: string,
  key: MeasurementKey,
  value: number,
): DesignSession | null {
  const sketch: Sketch = sessionSketch(session);
  for (const mapping of FIELD_DIMENSIONS) {
    if (mapping.key !== key) continue;
    const owner = sketchDimensions(sketch).find(
      (dimension) =>
        dimension.driving && dimension.entityId === entityId && dimension.kind === mapping.kind,
    );
    if (owner !== undefined) return driveSessionDimension(session, owner.id, value * mapping.scale);
  }
  return null;
}
