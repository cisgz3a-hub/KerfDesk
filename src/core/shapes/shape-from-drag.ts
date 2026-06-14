// shape-from-drag — map a two-point canvas drag (start + current, both in
// scene millimetres) to a placed kind:'shape' SceneObject. The drawing tool
// (ADR-051, Phase G, B5) calls this on every mouse-move (the live draft) and
// on mouse-up (the commit). Pure — the caller supplies the id and colour so
// core stays free of crypto / RNG.
//
// Rect and ellipse fill the drag's bounding box exactly. A regular polygon has
// no single "fill the box" answer, so it inscribes a hexagon: radius = half the
// shorter box side, centred in the box.

import { IDENTITY_TRANSFORM, type ShapeObject, type Vec2 } from '../scene';
import { createEllipse } from './create-ellipse';
import { createPolygon } from './create-polygon';
import { createRectangle } from './create-rectangle';

export type DrawShapeKind = 'rect' | 'ellipse' | 'polygon';

// LightBurn's polygon tool defaults to 6 sides; B5 follows suit until a
// per-shape sides control lands (B6+).
const DEFAULT_POLYGON_SIDES = 6;

// A click — or a sub-millimetre twitch — shouldn't spawn a degenerate shape.
// The tool commits only when the drag clears this on at least one axis (a thin
// tall rectangle is legitimate; a zero-by-zero click is not).
export const MIN_DRAW_SIZE_MM = 0.5;

export function shapeFromDrag(args: {
  readonly kind: DrawShapeKind;
  readonly start: Vec2;
  readonly end: Vec2;
  readonly id: string;
  readonly color: string;
}): ShapeObject {
  const minX = Math.min(args.start.x, args.end.x);
  const minY = Math.min(args.start.y, args.end.y);
  const widthMm = Math.abs(args.end.x - args.start.x);
  const heightMm = Math.abs(args.end.y - args.start.y);
  const { id, color } = args;
  if (args.kind === 'rect') {
    const transform = { ...IDENTITY_TRANSFORM, x: minX, y: minY };
    return createRectangle({
      id,
      color,
      spec: { widthMm, heightMm, cornerRadiusMm: 0 },
      transform,
    });
  }
  if (args.kind === 'ellipse') {
    const transform = { ...IDENTITY_TRANSFORM, x: minX, y: minY };
    return createEllipse({ id, color, spec: { widthMm, heightMm }, transform });
  }
  const radiusMm = Math.min(widthMm, heightMm) / 2;
  // Polygon geometry centres its vertices at (radius, radius) in local space,
  // so shift the transform to drop that centre onto the drag box's centre.
  const transform = {
    ...IDENTITY_TRANSFORM,
    x: minX + widthMm / 2 - radiusMm,
    y: minY + heightMm / 2 - radiusMm,
  };
  return createPolygon({ id, color, spec: { sides: DEFAULT_POLYGON_SIDES, radiusMm }, transform });
}

export function isDrawDragSignificant(start: Vec2, end: Vec2): boolean {
  return (
    Math.abs(end.x - start.x) >= MIN_DRAW_SIZE_MM || Math.abs(end.y - start.y) >= MIN_DRAW_SIZE_MM
  );
}
