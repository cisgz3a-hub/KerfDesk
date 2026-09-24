// node-align — the two alignment rules of the node editor's A key (ADR-376).
// With several nodes selected they line up on one axis: the axis they already
// spread less across, so a nearly level row snaps level instead of collapsing
// into a column. Over a segment, A turns the artwork until that segment lies
// on the nearest horizontal, vertical or 45° line, as LightBurn documents:
// https://docs.lightburnsoftware.com/2.1/Reference/EditNodes/
//
// Pure core — no I/O, no globals, deterministic. Points are in scene space.

import type { Vec2 } from '../scene';

export type NodeAlignAxis = 'horizontal' | 'vertical';

const EPSILON = 1e-9;
const ALIGN_STEP_DEG = 45;

/** 'horizontal' gives every point one y; 'vertical' gives them one x. */
export function nodeAlignAxis(points: ReadonlyArray<Vec2>): NodeAlignAxis | null {
  if (points.length < 2) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadY = Math.max(...ys) - Math.min(...ys);
  return spreadY <= spreadX ? 'horizontal' : 'vertical';
}

/** The points moved onto the reference's line along `axis`. */
export function alignNodePoints(
  points: ReadonlyArray<Vec2>,
  reference: Vec2,
  axis: NodeAlignAxis,
): ReadonlyArray<Vec2> {
  return points.map((point) =>
    axis === 'horizontal' ? { x: point.x, y: reference.y } : { x: reference.x, y: point.y },
  );
}

/** Degrees to add to the artwork's rotation so the line from `from` to `to`
 *  lands on the nearest multiple of 45°. Positive turns clockwise on screen,
 *  the same sense as Transform.rotationDeg. Null for a zero-length line or
 *  one that is already aligned. */
export function segmentAlignRotationDeg(from: Vec2, to: Vec2): number | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) <= EPSILON) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const delta = Math.round(angle / ALIGN_STEP_DEG) * ALIGN_STEP_DEG - angle;
  return Math.abs(delta) <= 1e-7 ? null : delta;
}
