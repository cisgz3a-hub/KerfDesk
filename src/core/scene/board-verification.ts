import type { BoardShape } from './board-capture';
import type { Vec2 } from './scene-object';

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
    };

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
  | { readonly kind: 'circle'; readonly anchor: CircleBoardVerificationAnchor };

export type BoardGeometryCorrection = {
  readonly geometry: CapturedBoardGeometry;
  readonly crossAxisErrorMm: number;
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
  return geometry.kind === 'rect'
    ? { kind: 'rect', widthMm: geometry.widthMm, heightMm: geometry.heightMm }
    : { kind: 'circle', diameterMm: geometry.radiusMm * 2 };
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
  return null;
}

export function verificationTargetChangesOrigin(target: BoardVerificationTarget): boolean {
  return (
    (target.kind === 'rect' && target.anchor === 'bottom-left') ||
    (target.kind === 'circle' && target.anchor === 'center')
  );
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

function isFinitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
