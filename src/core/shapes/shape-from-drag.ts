// shape-from-drag - map a two-point canvas drag (start + current, both in
// scene millimetres) to a placed kind:'shape' SceneObject. The drawing tool
// calls this on every mouse-move (the live draft) and on mouse-up (commit).
// Pure: the caller supplies the id and colour so core stays free of UI/RNG.

import { IDENTITY_TRANSFORM, type ShapeObject, type Transform, type Vec2 } from '../scene';
import { createEllipse } from './create-ellipse';
import { createPolygon } from './create-polygon';
import { createRectangle } from './create-rectangle';

export type DrawShapeKind = 'rect' | 'ellipse' | 'polygon';
export type DrawShapeModifiers = {
  readonly regular?: boolean;
  readonly fromCenter?: boolean;
};

// LightBurn's polygon tool defaults to 6 sides; LaserForge follows that until a
// per-shape sides control lands.
const DEFAULT_POLYGON_SIDES = 6;

// A click or sub-millimetre twitch should not spawn a degenerate primitive.
// Closed shapes need real width and height, except Shift/regular mode where one
// axis intentionally implies the other.
export const MIN_DRAW_SIZE_MM = 0.5;

export function shapeFromDrag(args: {
  readonly kind: DrawShapeKind;
  readonly start: Vec2;
  readonly end: Vec2;
  readonly id: string;
  readonly color: string;
  readonly modifiers?: DrawShapeModifiers;
}): ShapeObject {
  const box = dragBox(args.start, args.end, args.modifiers);
  const { id, color } = args;
  if (args.kind === 'rect') {
    return createRectangle({
      id,
      color,
      spec: { widthMm: box.widthMm, heightMm: box.heightMm, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: box.minX, y: box.minY },
    });
  }
  if (args.kind === 'ellipse') {
    return createEllipse({
      id,
      color,
      spec: { widthMm: box.widthMm, heightMm: box.heightMm },
      transform: { ...IDENTITY_TRANSFORM, x: box.minX, y: box.minY },
    });
  }
  return polygonInBox({ id, color, box, regular: args.modifiers?.regular === true });
}

export function isDrawDragSignificant(
  start: Vec2,
  end: Vec2,
  modifiers?: DrawShapeModifiers,
): boolean {
  const box = dragBox(start, end, modifiers);
  if (box.widthMm === 0 || box.heightMm === 0) return false;
  return Math.max(box.widthMm, box.heightMm) >= MIN_DRAW_SIZE_MM;
}

type DrawBox = {
  readonly minX: number;
  readonly minY: number;
  readonly widthMm: number;
  readonly heightMm: number;
};

function dragBox(start: Vec2, end: Vec2, modifiers?: DrawShapeModifiers): DrawBox {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const regular = modifiers?.regular === true;
  if (modifiers?.fromCenter === true) {
    const halfWidth = regular ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.abs(dx);
    const halfHeight = regular ? halfWidth : Math.abs(dy);
    return {
      minX: start.x - halfWidth,
      minY: start.y - halfHeight,
      widthMm: halfWidth * 2,
      heightMm: halfHeight * 2,
    };
  }
  const widthMm = regular ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.abs(dx);
  const heightMm = regular ? widthMm : Math.abs(dy);
  return {
    minX: dx >= 0 ? start.x : start.x - widthMm,
    minY: dy >= 0 ? start.y : start.y - heightMm,
    widthMm,
    heightMm,
  };
}

function polygonInBox(args: {
  readonly id: string;
  readonly color: string;
  readonly box: DrawBox;
  readonly regular: boolean;
}): ShapeObject {
  const unit = createPolygon({
    id: args.id,
    color: args.color,
    spec: { sides: DEFAULT_POLYGON_SIDES, radiusMm: 1 },
  });
  const naturalWidth = unit.bounds.maxX - unit.bounds.minX;
  const naturalHeight = unit.bounds.maxY - unit.bounds.minY;
  const scaleX = args.box.widthMm / naturalWidth;
  const scaleY = args.box.heightMm / naturalHeight;
  const transform = args.regular
    ? regularPolygonTransform(unit, args.box, Math.min(scaleX, scaleY))
    : polygonBoxTransform(unit, args.box, scaleX, scaleY);
  return { ...unit, transform };
}

function polygonBoxTransform(
  shape: ShapeObject,
  box: DrawBox,
  scaleX: number,
  scaleY: number,
): Transform {
  return {
    ...IDENTITY_TRANSFORM,
    x: box.minX - shape.bounds.minX * scaleX,
    y: box.minY - shape.bounds.minY * scaleY,
    scaleX,
    scaleY,
  };
}

function regularPolygonTransform(shape: ShapeObject, box: DrawBox, scale: number): Transform {
  const naturalWidth = shape.bounds.maxX - shape.bounds.minX;
  const naturalHeight = shape.bounds.maxY - shape.bounds.minY;
  const actualWidth = naturalWidth * scale;
  const actualHeight = naturalHeight * scale;
  return {
    ...IDENTITY_TRANSFORM,
    x: box.minX + (box.widthMm - actualWidth) / 2 - shape.bounds.minX * scale,
    y: box.minY + (box.heightMm - actualHeight) / 2 - shape.bounds.minY * scale,
    scaleX: scale,
    scaleY: scale,
  };
}
