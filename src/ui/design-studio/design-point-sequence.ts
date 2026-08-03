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

export type PathPointSequence = {
  readonly kind: 'path';
  readonly points: ReadonlyArray<Vec2>;
  readonly pointerMm: Vec2;
  // A browser double-click delivers two pointer-down transitions before the
  // dblclick event. Remember the state before the latest click so that event
  // can discard only its second constituent click, even when it drifted.
  readonly pointsBeforeLastClick?: ReadonlyArray<Vec2>;
};

export type ArcPointSequence = {
  readonly kind: 'arc';
  readonly centerMm: Vec2;
  readonly startMm: Vec2 | null;
  readonly pointerMm: Vec2;
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
  const distanceToFirstMm =
    first === undefined ? Number.POSITIVE_INFINITY : distanceMm(first, atMm);
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
  const distanceToFirstMm = distanceMm(first, atMm);
  if (
    sequence.points.length >= 3 &&
    distanceToFirstMm <= closeToleranceMm &&
    (!hasObjectSnap || samePointMm(first, atMm))
  ) {
    return { kind: 'commit', points: sequence.points };
  }
  if (distanceMm(last, atMm) < MIN_ENTITY_SIZE_MM) {
    return { kind: 'continue', sequence: withoutLastClickSnapshot(sequence) };
  }
  return {
    kind: 'continue',
    sequence: {
      ...sequence,
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
  if (last === undefined || distanceMm(last, sequence.pointerMm) < MIN_ENTITY_SIZE_MM) {
    return sequence.points;
  }
  return [...sequence.points, sequence.pointerMm];
}

export function constrainArcTarget(
  sequence: ArcPointSequence,
  atMm: Vec2,
  constraint: PointTargetConstraint,
): Vec2 {
  const { hasObjectSnap, orthoEnabled } = constraint;
  const constrained = hasObjectSnap ? atMm : applyOrthoMm(sequence.centerMm, atMm, orthoEnabled);
  if (sequence.startMm === null) return constrained;
  const radiusMm = distanceMm(sequence.centerMm, sequence.startMm);
  const distanceToTargetMm = distanceMm(sequence.centerMm, constrained);
  if (distanceToTargetMm < MIN_ENTITY_SIZE_MM) return constrained;
  const scale = radiusMm / distanceToTargetMm;
  return {
    x: sequence.centerMm.x + (constrained.x - sequence.centerMm.x) * scale,
    y: sequence.centerMm.y + (constrained.y - sequence.centerMm.y) * scale,
  };
}

export function advanceArcSequence(sequence: ArcPointSequence, atMm: Vec2): ArcSequenceAdvance {
  if (sequence.startMm === null) {
    if (distanceMm(sequence.centerMm, atMm) < MIN_ENTITY_SIZE_MM) {
      return { kind: 'continue', sequence: { ...sequence, pointerMm: atMm } };
    }
    return {
      kind: 'continue',
      sequence: { ...sequence, startMm: atMm, pointerMm: atMm },
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
  const radiusMm = distanceMm(sequence.centerMm, sequence.startMm);
  const targetRadiusMm = distanceMm(sequence.centerMm, atMm);
  const epsilonMm = Number.EPSILON * 64 * Math.max(1, radiusMm, targetRadiusMm);
  return Math.abs(targetRadiusMm - radiusMm) <= epsilonMm;
}

export function pointSequencePreviewPolylines(
  sequence: DesignPointSequence,
): ReadonlyArray<Polyline> {
  if (sequence.kind === 'path') {
    return [{ points: pathSequencePreviewPoints(sequence), closed: false }];
  }
  if (sequence.startMm === null) {
    return [{ points: [sequence.centerMm, sequence.pointerMm], closed: false }];
  }
  const geometry = arcGeometry(sequence, sequence.pointerMm);
  if (geometry === null) {
    return [{ points: [sequence.centerMm, sequence.startMm], closed: false }];
  }
  return entityToPolylines({ ...geometry, id: 'arc-preview' });
}

function arcGeometry(sequence: ArcPointSequence, endMm: Vec2): Omit<SketchArc, 'id'> | null {
  const startMm = sequence.startMm;
  if (startMm === null) return null;
  const radiusMm = distanceMm(sequence.centerMm, startMm);
  if (radiusMm < MIN_ENTITY_SIZE_MM || distanceMm(sequence.centerMm, endMm) < MIN_ENTITY_SIZE_MM) {
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

function distanceMm(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function samePointMm(a: Vec2, b: Vec2): boolean {
  const coordinateScale = Math.max(1, Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y));
  return distanceMm(a, b) <= Number.EPSILON * 64 * coordinateScale;
}
