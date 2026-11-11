// Point-sequence drawing state for click-driven tools. Kept outside DesignDraft:
// a drag has one anchor and one live point, while a Polyline owns every confirmed
// corner until it closes or the operator double-clicks to finish it open.

import {
  entityToPolylines,
  MIN_ENTITY_SIZE_MM,
  type SketchArc,
  type SketchPath,
} from '../../core/design';
import type { Polyline, Vec2 } from '../../core/scene';
import { applyOrthoMm } from './design-snap';
import { distance } from '../../core/geometry/point-math';
import { lockPolarPoint, lockSweepEnd, type EntryLocks } from '../../core/design/entry';

export type PathPointSequence = {
  readonly kind: 'path';
  readonly points: ReadonlyArray<Vec2>;
  readonly pointerMm: Vec2;
  // A browser double-click delivers two pointer-down transitions before the
  // dblclick event. Remember the state before the latest click so that event
  // can discard only its second constituent click, even when it drifted.
  readonly pointsBeforeLastClick?: ReadonlyArray<Vec2>;
  // Length / angle typed for the NEXT segment (ADR-272 Amendment 5). Dropped
  // as soon as that segment's corner is placed: each segment is typed afresh.
  readonly locks?: EntryLocks;
};

export type ArcPointSequence = {
  readonly kind: 'arc';
  readonly centerMm: Vec2;
  readonly startMm: Vec2 | null;
  readonly pointerMm: Vec2;
  // Radius / start angle while placing the start, sweep while placing the end
  // (ADR-272 Amendment 5). Dropped when the start is placed.
  readonly locks?: EntryLocks;
};

export type DesignPointSequence = PathPointSequence | ArcPointSequence;

export type PathSequenceAdvance =
  | { readonly kind: 'continue'; readonly sequence: PathPointSequence }
  | { readonly kind: 'commit'; readonly points: ReadonlyArray<Vec2> };

export type ArcSequenceAdvance =
  | { readonly kind: 'continue'; readonly sequence: ArcPointSequence }
  | { readonly kind: 'commit'; readonly geometry: Omit<SketchArc, 'id'> };

export type PointTargetConstraint = {
  readonly orthoEnabled: boolean;
  readonly hasObjectSnap: boolean;
};

export type PathTargetConstraint = PointTargetConstraint & {
  readonly closeToleranceMm: number;
};

export type PathAdvanceOptions = {
  readonly closeToleranceMm: number;
  readonly hasObjectSnap: boolean;
};

export const POINT_SEQUENCE_CLOSE_RADIUS_PX = 8;
const FULL_TURN_DEG = 360;

export function beginPathSequence(atMm: Vec2): PathPointSequence {
  return { kind: 'path', points: [atMm], pointerMm: atMm };
}

export function beginArcSequence(centerMm: Vec2): ArcPointSequence {
  return { kind: 'arc', centerMm, startMm: null, pointerMm: centerMm };
}

export function updatePointSequence(
  sequence: PathPointSequence,
  pointerMm: Vec2,
): PathPointSequence {
  return { ...sequence, pointerMm };
}

export function constrainPathTarget(
  sequence: PathPointSequence,
  atMm: Vec2,
  constraint: PathTargetConstraint,
): Vec2 {
  const { closeToleranceMm, hasObjectSnap, orthoEnabled } = constraint;
  const first = sequence.points[0];
  const distanceToFirstMm = first === undefined ? Number.POSITIVE_INFINITY : distance(first, atMm);
  if (
    first !== undefined &&
    sequence.points.length >= 3 &&
    distanceToFirstMm <= closeToleranceMm &&
    (!hasObjectSnap || samePointMm(first, atMm))
  ) {
    return first;
  }
  if (!orthoEnabled || hasObjectSnap) return atMm;
  const last = sequence.points[sequence.points.length - 1];
  return last === undefined ? atMm : applyOrthoMm(last, atMm, true);
}

export function advancePathSequence(
  sequence: PathPointSequence,
  atMm: Vec2,
  options: PathAdvanceOptions,
): PathSequenceAdvance {
  const { closeToleranceMm, hasObjectSnap } = options;
  const first = sequence.points[0];
  const last = sequence.points[sequence.points.length - 1];
  if (first === undefined || last === undefined) return { kind: 'continue', sequence };
  const distanceToFirstMm = distance(first, atMm);
  if (
    sequence.points.length >= 3 &&
    distanceToFirstMm <= closeToleranceMm &&
    (!hasObjectSnap || samePointMm(first, atMm))
  ) {
    return { kind: 'commit', points: sequence.points };
  }
  if (distance(last, atMm) < MIN_ENTITY_SIZE_MM) {
    return { kind: 'continue', sequence: withoutLastClickSnapshot(sequence) };
  }
  return {
    kind: 'continue',
    sequence: {
      kind: 'path',
      points: [...sequence.points, atMm],
      pointerMm: atMm,
      pointsBeforeLastClick: sequence.points,
    },
  };
}

export function finishOpenPath(
  sequence: PathPointSequence,
  id: string,
  options: { readonly discardLastClick?: boolean } = {},
): SketchPath | null {
  const points =
    options.discardLastClick === true && sequence.pointsBeforeLastClick !== undefined
      ? sequence.pointsBeforeLastClick
      : sequence.points;
  if (points.length < 2) return null;
  return { kind: 'path', id, points, closed: false };
}

export function pathSequencePreviewPoints(sequence: PathPointSequence): ReadonlyArray<Vec2> {
  const last = sequence.points[sequence.points.length - 1];
  const target = lockedPathTarget(sequence, sequence.pointerMm);
  if (last === undefined || distance(last, target) < MIN_ENTITY_SIZE_MM) {
    return sequence.points;
  }
  return [...sequence.points, target];
}

// Where the next corner lands once a typed length / angle is honoured, measured
// from the last placed corner.
export function lockedPathTarget(sequence: PathPointSequence, atMm: Vec2): Vec2 {
  const last = sequence.points[sequence.points.length - 1];
  const locks = sequence.locks;
  if (last === undefined || locks === undefined) return atMm;
  return lockPolarPoint(last, atMm, { lengthMm: locks.length, angleDeg: locks.angle });
}

// The arc's next point once typed values are honoured: a radius and start
// angle place the start about the centre; a sweep places the end.
export function lockedArcTarget(sequence: ArcPointSequence, atMm: Vec2): Vec2 {
  const locks = sequence.locks;
  if (locks === undefined) return atMm;
  if (sequence.startMm === null) {
    return lockPolarPoint(sequence.centerMm, atMm, {
      lengthMm: locks.radius,
      angleDeg: locks.angle,
    });
  }
  return locks.sweep === undefined
    ? atMm
    : lockSweepEnd(sequence.centerMm, sequence.startMm, locks.sweep);
}

export function constrainArcTarget(
  sequence: ArcPointSequence,
  atMm: Vec2,
  constraint: PointTargetConstraint,
): Vec2 {
  const { hasObjectSnap, orthoEnabled } = constraint;
  const constrained = hasObjectSnap ? atMm : applyOrthoMm(sequence.centerMm, atMm, orthoEnabled);
  if (sequence.startMm === null) return constrained;
  const radiusMm = distance(sequence.centerMm, sequence.startMm);
  const distanceToTargetMm = distance(sequence.centerMm, constrained);
  if (distanceToTargetMm < MIN_ENTITY_SIZE_MM) return constrained;
  const scale = radiusMm / distanceToTargetMm;
  return {
    x: sequence.centerMm.x + (constrained.x - sequence.centerMm.x) * scale,
    y: sequence.centerMm.y + (constrained.y - sequence.centerMm.y) * scale,
  };
}

export function advanceArcSequence(sequence: ArcPointSequence, atMm: Vec2): ArcSequenceAdvance {
  if (sequence.startMm === null) {
    if (distance(sequence.centerMm, atMm) < MIN_ENTITY_SIZE_MM) {
      return { kind: 'continue', sequence: { ...sequence, pointerMm: atMm } };
    }
    return {
      kind: 'continue',
      sequence: { kind: 'arc', centerMm: sequence.centerMm, startMm: atMm, pointerMm: atMm },
    };
  }
  const geometry = arcGeometry(sequence, atMm);
  return geometry === null
    ? { kind: 'continue', sequence: { ...sequence, pointerMm: atMm } }
    : { kind: 'commit', geometry };
}

export function updateArcSequence(sequence: ArcPointSequence, pointerMm: Vec2): ArcPointSequence {
  return { ...sequence, pointerMm };
}

export function arcSnapMatchesRadius(sequence: ArcPointSequence, atMm: Vec2): boolean {
  if (sequence.startMm === null) return true;
  const radiusMm = distance(sequence.centerMm, sequence.startMm);
  const targetRadiusMm = distance(sequence.centerMm, atMm);
  const epsilonMm = Number.EPSILON * 64 * Math.max(1, radiusMm, targetRadiusMm);
  return Math.abs(targetRadiusMm - radiusMm) <= epsilonMm;
}

export function pointSequencePreviewPolylines(
  sequence: DesignPointSequence,
): ReadonlyArray<Polyline> {
  if (sequence.kind === 'path') {
    return [{ points: pathSequencePreviewPoints(sequence), closed: false }];
  }
  const pointerMm = lockedArcTarget(sequence, sequence.pointerMm);
  if (sequence.startMm === null) {
    return [{ points: [sequence.centerMm, pointerMm], closed: false }];
  }
  const geometry = arcGeometry(sequence, pointerMm);
  if (geometry === null) {
    return [{ points: [sequence.centerMm, sequence.startMm], closed: false }];
  }
  return entityToPolylines({ ...geometry, id: 'arc-preview' });
}

function arcGeometry(sequence: ArcPointSequence, endMm: Vec2): Omit<SketchArc, 'id'> | null {
  const startMm = sequence.startMm;
  if (startMm === null) return null;
  const radiusMm = distance(sequence.centerMm, startMm);
  if (radiusMm < MIN_ENTITY_SIZE_MM || distance(sequence.centerMm, endMm) < MIN_ENTITY_SIZE_MM) {
    return null;
  }
  const startAngleDeg = angleDeg(sequence.centerMm, startMm);
  const endAngleDeg = angleDeg(sequence.centerMm, endMm);
  const sweepDeg =
    (((endAngleDeg - startAngleDeg) % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG;
  if (sweepDeg < MIN_ENTITY_SIZE_MM) return null;
  return { kind: 'arc', center: sequence.centerMm, radiusMm, startAngleDeg, sweepDeg };
}

function angleDeg(centerMm: Vec2, atMm: Vec2): number {
  return (Math.atan2(atMm.y - centerMm.y, atMm.x - centerMm.x) * 180) / Math.PI;
}

function withoutLastClickSnapshot(sequence: PathPointSequence): PathPointSequence {
  return {
    kind: 'path',
    points: sequence.points,
    pointerMm: sequence.pointerMm,
  };
}

function samePointMm(a: Vec2, b: Vec2): boolean {
  const coordinateScale = Math.max(1, Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y));
  return distance(a, b) <= Number.EPSILON * 64 * coordinateScale;
}
