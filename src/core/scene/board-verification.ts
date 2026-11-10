import type { BoardShape } from './board-capture';
import {
  correctOutlineGeometry,
  outlineBoardShape,
  outlineMachinePoints,
  type OutlineBoardGeometry,
} from './board-outline-registration';
import type { Vec2 } from './scene-object';
import { isFinitePoint } from '../geometry/point-math';

export type CapturedBoardGeometry =
  | {
      readonly kind: 'rect';
      readonly origin: Vec2;
      readonly widthMm: number;
      readonly heightMm: number;
    }
  | {
      readonly kind: 'circle';
      readonly center: Vec2;
      readonly radiusMm: number;
    }
  | OutlineBoardGeometry;

export type RectangleBoardVerificationAnchor =
  | 'bottom-left'
  | 'bottom-right'
  | 'top-left'
  | 'top-right';
export type CircleBoardVerificationAnchor =
  | 'center'
  | 'rim-top'
  | 'rim-right'
  | 'rim-bottom'
  | 'rim-left';
export type BoardVerificationTarget =
  | { readonly kind: 'rect'; readonly anchor: RectangleBoardVerificationAnchor }
  | { readonly kind: 'circle'; readonly anchor: CircleBoardVerificationAnchor }
  | { readonly kind: 'outline'; readonly index: number; readonly ordinal: number };

export type BoardGeometryCorrection = {
  readonly geometry: CapturedBoardGeometry;
  readonly crossAxisErrorMm: number;
  readonly residualMm?: number;
};

export const RECTANGLE_BOARD_VERIFICATION_ANCHORS = [
  'bottom-left',
  'bottom-right',
  'top-left',
  'top-right',
] as const satisfies ReadonlyArray<RectangleBoardVerificationAnchor>;

export const CIRCLE_BOARD_VERIFICATION_ANCHORS = [
  'center',
  'rim-top',
  'rim-right',
  'rim-bottom',
  'rim-left',
] as const satisfies ReadonlyArray<CircleBoardVerificationAnchor>;

export function capturedBoardShape(geometry: CapturedBoardGeometry): BoardShape {
  switch (geometry.kind) {
    case 'rect':
      return { kind: 'rect', widthMm: geometry.widthMm, heightMm: geometry.heightMm };
    case 'circle':
      return { kind: 'circle', diameterMm: geometry.radiusMm * 2 };
    case 'outline':
      return (
        outlineBoardShape(geometry) ?? {
          kind: 'outline',
          pointsMm: geometry.localPointsMm,
          anchorIndices: geometry.anchorIndices,
        }
      );
  }
}

export function boardVerificationPoint(
  geometry: CapturedBoardGeometry,
  target: BoardVerificationTarget,
): Vec2 | null {
  if (geometry.kind !== target.kind) return null;
  if (geometry.kind === 'rect' && target.kind === 'rect') {
    return rectangleVerificationPoint(geometry, target.anchor);
  }
  if (geometry.kind === 'circle' && target.kind === 'circle') {
    return circleVerificationPoint(geometry, target.anchor);
  }
  if (geometry.kind === 'outline' && target.kind === 'outline') {
    if (!geometry.anchorIndices.includes(target.index)) return null;
    return outlineMachinePoints(geometry)?.[target.index] ?? null;
  }
  return null;
}

function rectangleVerificationPoint(
  geometry: Extract<CapturedBoardGeometry, { readonly kind: 'rect' }>,
  anchor: RectangleBoardVerificationAnchor,
): Vec2 {
  const right = geometry.origin.x + geometry.widthMm;
  const top = geometry.origin.y + geometry.heightMm;
  switch (anchor) {
    case 'bottom-left':
      return geometry.origin;
    case 'bottom-right':
      return { x: right, y: geometry.origin.y };
    case 'top-left':
      return { x: geometry.origin.x, y: top };
    case 'top-right':
      return { x: right, y: top };
  }
}

function circleVerificationPoint(
  geometry: Extract<CapturedBoardGeometry, { readonly kind: 'circle' }>,
  anchor: CircleBoardVerificationAnchor,
): Vec2 {
  switch (anchor) {
    case 'center':
      return geometry.center;
    case 'rim-top':
      return { x: geometry.center.x, y: geometry.center.y + geometry.radiusMm };
    case 'rim-right':
      return { x: geometry.center.x + geometry.radiusMm, y: geometry.center.y };
    case 'rim-bottom':
      return { x: geometry.center.x, y: geometry.center.y - geometry.radiusMm };
    case 'rim-left':
      return { x: geometry.center.x - geometry.radiusMm, y: geometry.center.y };
  }
}

export function correctCapturedBoardGeometry(
  geometry: CapturedBoardGeometry,
  target: BoardVerificationTarget,
  confirmed: Vec2,
): BoardGeometryCorrection | null {
  if (!isFinitePoint(confirmed) || geometry.kind !== target.kind) return null;
  if (geometry.kind === 'rect' && target.kind === 'rect') {
    return correctRectangle(geometry, target.anchor, confirmed);
  }
  if (geometry.kind === 'circle' && target.kind === 'circle') {
    if (target.anchor === 'center') {
      return { geometry: { ...geometry, center: confirmed }, crossAxisErrorMm: 0 };
    }
    const dx = confirmed.x - geometry.center.x;
    const dy = confirmed.y - geometry.center.y;
    const radiusMm = Math.hypot(dx, dy);
    if (radiusMm <= 0) return null;
    return {
      geometry: { ...geometry, radiusMm },
      crossAxisErrorMm: circleRimCrossAxisErrorMm(target.anchor, dx, dy),
    };
  }
  if (geometry.kind === 'outline' && target.kind === 'outline') {
    const correction = correctOutlineGeometry(geometry, target.index, confirmed);
    return correction === null
      ? null
      : {
          geometry: correction.geometry,
          crossAxisErrorMm: correction.predictionErrorMm,
          residualMm: correction.maxResidualMm,
        };
  }
  return null;
}

export function verificationTargetChangesOrigin(target: BoardVerificationTarget): boolean {
  if (target.kind === 'outline') return true;
  return (
    (target.kind === 'rect' && target.anchor === 'bottom-left') ||
    (target.kind === 'circle' && target.anchor === 'center')
  );
}

export function boardVerificationTargets(
  geometry: CapturedBoardGeometry,
): BoardVerificationTarget[] {
  switch (geometry.kind) {
    case 'rect':
      return RECTANGLE_BOARD_VERIFICATION_ANCHORS.map((anchor) => ({ kind: 'rect', anchor }));
    case 'circle':
      return CIRCLE_BOARD_VERIFICATION_ANCHORS.map((anchor) => ({ kind: 'circle', anchor }));
    case 'outline':
      return geometry.anchorIndices.map((index, position) => ({
        kind: 'outline',
        index,
        ordinal: position + 1,
      }));
  }
}

export function boardVerificationTargetsEqual(
  left: BoardVerificationTarget,
  right: BoardVerificationTarget,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'rect' && right.kind === 'rect') return left.anchor === right.anchor;
  if (left.kind === 'circle' && right.kind === 'circle') return left.anchor === right.anchor;
  return left.kind === 'outline' && right.kind === 'outline' && left.index === right.index;
}

function correctRectangle(
  geometry: Extract<CapturedBoardGeometry, { readonly kind: 'rect' }>,
  anchor: RectangleBoardVerificationAnchor,
  confirmed: Vec2,
): BoardGeometryCorrection | null {
  let next = geometry;
  let crossAxisErrorMm = 0;
  switch (anchor) {
    case 'bottom-left':
      next = { ...geometry, origin: confirmed };
      break;
    case 'bottom-right':
      next = { ...geometry, widthMm: confirmed.x - geometry.origin.x };
      crossAxisErrorMm = Math.abs(confirmed.y - geometry.origin.y);
      break;
    case 'top-left':
      next = { ...geometry, heightMm: confirmed.y - geometry.origin.y };
      crossAxisErrorMm = Math.abs(confirmed.x - geometry.origin.x);
      break;
    case 'top-right':
      next = {
        ...geometry,
        widthMm: confirmed.x - geometry.origin.x,
        heightMm: confirmed.y - geometry.origin.y,
      };
      break;
  }
  if (!Number.isFinite(next.widthMm) || !Number.isFinite(next.heightMm)) return null;
  if (next.widthMm <= 0 || next.heightMm <= 0) return null;
  return { geometry: next, crossAxisErrorMm };
}

function circleRimCrossAxisErrorMm(
  anchor: Exclude<CircleBoardVerificationAnchor, 'center'>,
  dx: number,
  dy: number,
): number {
  switch (anchor) {
    case 'rim-top':
    case 'rim-bottom':
      return Math.abs(dx);
    case 'rim-right':
    case 'rim-left':
      return Math.abs(dy);
  }
}
