import type { BoardShape } from './board-capture';
import { boardPolygonWithPoint, type BoardAxisSigns, type BoardPolygon } from './board-polygon';
import type { Vec2 } from './scene-object';

export type CapturedBoardGeometry =
  | {
      readonly kind: 'rect';
      // The physical front-left corner (the work origin), in machine mm.
      readonly origin: Vec2;
      readonly widthMm: number;
      readonly heightMm: number;
      // Machine axis per physical direction; absent = front-left (+X right,
      // +Y away from the operator). Rear/right origins mirror an axis.
      readonly axisSigns?: BoardAxisSigns;
    }
  | {
      readonly kind: 'circle';
      readonly center: Vec2;
      readonly radiusMm: number;
      readonly axisSigns?: BoardAxisSigns;
    }
  | {
      // A custom-shape board (ADR-636): its corners in machine coordinates and
      // the work origin at the physical front-left of their bounding box.
      readonly kind: 'polygon';
      readonly polygon: BoardPolygon;
      readonly axisSigns: BoardAxisSigns;
    };

const FRONT_LEFT_SIGNS: BoardAxisSigns = { x: 1, y: 1 };

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
  | { readonly kind: 'polygon'; readonly anchor: 'vertex'; readonly index: number };

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
  switch (geometry.kind) {
    case 'rect':
      return { kind: 'rect', widthMm: geometry.widthMm, heightMm: geometry.heightMm };
    case 'circle':
      return { kind: 'circle', diameterMm: geometry.radiusMm * 2 };
    case 'polygon':
      return {
        kind: 'polygon',
        widthMm: geometry.polygon.widthMm,
        heightMm: geometry.polygon.heightMm,
        outline: geometry.polygon.outline,
      };
  }
}

/** The machine point the work origin is set at for this board. */
export function capturedBoardOrigin(geometry: CapturedBoardGeometry): Vec2 {
  switch (geometry.kind) {
    case 'rect':
      return geometry.origin;
    case 'circle':
      return geometry.center;
    case 'polygon':
      return geometry.polygon.origin;
  }
}

/** Every reference point the operator can physically check on this board. */
export function boardVerificationTargets(
  geometry: CapturedBoardGeometry,
): ReadonlyArray<BoardVerificationTarget> {
  switch (geometry.kind) {
    case 'rect':
      return RECTANGLE_BOARD_VERIFICATION_ANCHORS.map((anchor) => ({ kind: 'rect', anchor }));
    case 'circle':
      return CIRCLE_BOARD_VERIFICATION_ANCHORS.map((anchor) => ({ kind: 'circle', anchor }));
    case 'polygon':
      return geometry.polygon.points.map((_, index) => ({ kind: 'polygon', anchor: 'vertex', index }));
  }
}

export function sameBoardVerificationTarget(
  left: BoardVerificationTarget,
  right: BoardVerificationTarget | null,
): boolean {
  if (right === null || left.kind !== right.kind || left.anchor !== right.anchor) return false;
  return left.kind !== 'polygon' || (right.kind === 'polygon' && left.index === right.index);
}

export function boardVerificationTargetKey(target: BoardVerificationTarget): string {
  return target.kind === 'polygon'
    ? `polygon:vertex-${target.index}`
    : `${target.kind}:${target.anchor}`;
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
  if (geometry.kind === 'polygon' && target.kind === 'polygon') {
    return geometry.polygon.points[target.index] ?? null;
  }
  return null;
}

function rectangleVerificationPoint(
  geometry: Extract<CapturedBoardGeometry, { readonly kind: 'rect' }>,
  anchor: RectangleBoardVerificationAnchor,
): Vec2 {
  const signs = geometry.axisSigns ?? FRONT_LEFT_SIGNS;
  const right = geometry.origin.x + signs.x * geometry.widthMm;
  const top = geometry.origin.y + signs.y * geometry.heightMm;
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
  const { x: sx, y: sy } = geometry.axisSigns ?? FRONT_LEFT_SIGNS;
  const { center, radiusMm } = geometry;
  switch (anchor) {
    case 'center':
      return center;
    case 'rim-top':
      return { x: center.x, y: center.y + sy * radiusMm };
    case 'rim-right':
      return { x: center.x + sx * radiusMm, y: center.y };
    case 'rim-bottom':
      return { x: center.x, y: center.y - sy * radiusMm };
    case 'rim-left':
      return { x: center.x - sx * radiusMm, y: center.y };
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
  if (geometry.kind === 'polygon' && target.kind === 'polygon') {
    const polygon = boardPolygonWithPoint(
      geometry.polygon,
      target.index,
      confirmed,
      geometry.axisSigns,
    );
    return polygon === null
      ? null
      : { geometry: { ...geometry, polygon }, crossAxisErrorMm: 0 };
  }
  return null;
}

export function verificationTargetChangesOrigin(target: BoardVerificationTarget): boolean {
  return (
    (target.kind === 'rect' && target.anchor === 'bottom-left') ||
    (target.kind === 'circle' && target.anchor === 'center')
  );
}

/**
 * Whether a corrected board needs its work origin set again. A rectangle and a
 * circle move it only through their origin point; moving any corner of a
 * custom shape can move the front-left of its bounding box.
 */
export function boardCorrectionChangesOrigin(
  before: CapturedBoardGeometry,
  after: CapturedBoardGeometry,
  target: BoardVerificationTarget,
): boolean {
  if (target.kind !== 'polygon') return verificationTargetChangesOrigin(target);
  const a = capturedBoardOrigin(before);
  const b = capturedBoardOrigin(after);
  return Math.hypot(a.x - b.x, a.y - b.y) > 1e-6;
}

function correctRectangle(
  geometry: Extract<CapturedBoardGeometry, { readonly kind: 'rect' }>,
  anchor: RectangleBoardVerificationAnchor,
  confirmed: Vec2,
): BoardGeometryCorrection | null {
  let next = geometry;
  let crossAxisErrorMm = 0;
  const { x: sx, y: sy } = geometry.axisSigns ?? FRONT_LEFT_SIGNS;
  const width = sx * (confirmed.x - geometry.origin.x);
  const height = sy * (confirmed.y - geometry.origin.y);
  switch (anchor) {
    case 'bottom-left':
      next = { ...geometry, origin: confirmed };
      break;
    case 'bottom-right':
      next = { ...geometry, widthMm: width };
      crossAxisErrorMm = Math.abs(confirmed.y - geometry.origin.y);
      break;
    case 'top-left':
      next = { ...geometry, heightMm: height };
      crossAxisErrorMm = Math.abs(confirmed.x - geometry.origin.x);
      break;
    case 'top-right':
      next = { ...geometry, widthMm: width, heightMm: height };
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
