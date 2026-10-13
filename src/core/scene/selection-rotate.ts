// Free rotation, two-point rotate/scale and mirror across a line for a whole
// selection (LightBurn Edit Nodes Align, Two-Point Rotate / Scale, and Mirror
// Across Line). Each is a similarity of the plane, and every object's
// Transform composes with it exactly: applyTransform maps a local point as
// R(rotation) · Mirror · Scale · p + offset, so
//   - k·R(a) about c gives rotation + a, scale · k, offset c + k·R(a)(offset - c);
//   - reflection across a line at angle phi through q is R(2·phi)·D with
//     D = diag(1, -1), and D·R(theta) = R(-theta)·D, which gives rotation
//     2·phi - theta with mirrorY toggled and offset q + R(2·phi)·D(offset - q).
// No shear arises, so text, images and barcodes stay editable objects.

import { combinedBBox } from './hit-test';
import type { SceneObject, Transform, Vec2 } from './scene-object';
import { selectionAnchorPoint, type SelectionTransformResult } from './selection-transform';

const FULL_TURN_DEG = 360;
const MIN_SCALE = 1e-6;
const MIN_LINE_MM = 1e-9;

/** Turns every object by `deltaDeg` about `pivot`, or the selection centre. */
export function buildSelectionRotateByEdit(
  objects: ReadonlyArray<SceneObject>,
  deltaDeg: number,
  pivot?: Vec2,
): SelectionTransformResult {
  return buildSelectionRotateScaleEdit(objects, deltaDeg, 1, pivot);
}

/** Turns by `deltaDeg` and scales uniformly by `scale` about `pivot`. */
export function buildSelectionRotateScaleEdit(
  objects: ReadonlyArray<SceneObject>,
  deltaDeg: number,
  scale: number,
  pivot?: Vec2,
): SelectionTransformResult {
  if (!Number.isFinite(deltaDeg) || !Number.isFinite(scale)) {
    return { kind: 'error', reason: 'invalid-number' };
  }
  if (!(scale > MIN_SCALE)) return { kind: 'error', reason: 'invalid-dimension' };
  const centre = pivot ?? selectionCentre(objects);
  if (centre === null) return { kind: 'error', reason: 'empty-selection' };
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad) * scale;
  const sin = Math.sin(rad) * scale;
  return {
    kind: 'ok',
    transforms: objects.map((object) => {
      const t = object.transform;
      const dx = t.x - centre.x;
      const dy = t.y - centre.y;
      return {
        id: object.id,
        transform: {
          ...t,
          x: centre.x + dx * cos - dy * sin,
          y: centre.y + dx * sin + dy * cos,
          scaleX: t.scaleX * scale,
          scaleY: t.scaleY * scale,
          rotationDeg: normalizeDeg(t.rotationDeg + deltaDeg),
        },
      };
    }),
  };
}

/** Reflects every object across the line through `a` and `b`. */
export function buildSelectionMirrorAcrossLineEdit(
  objects: ReadonlyArray<SceneObject>,
  a: Vec2,
  b: Vec2,
): SelectionTransformResult {
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite))
    return { kind: 'error', reason: 'invalid-number' };
  if (objects.length === 0) return { kind: 'error', reason: 'empty-selection' };
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(length > MIN_LINE_MM)) return { kind: 'error', reason: 'degenerate-selection' };
  const phiDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return {
    kind: 'ok',
    transforms: objects.map((object) => ({
      id: object.id,
      transform: mirrorTransform(object.transform, a, phiDeg),
    })),
  };
}

function mirrorTransform(t: Transform, q: Vec2, phiDeg: number): Transform {
  const twoPhi = (2 * phiDeg * Math.PI) / 180;
  const cos = Math.cos(twoPhi);
  const sin = Math.sin(twoPhi);
  // R(2phi)·D applied to (offset - q), where D flips y.
  const dx = t.x - q.x;
  const dy = -(t.y - q.y);
  return {
    ...t,
    x: q.x + dx * cos - dy * sin,
    y: q.y + dx * sin + dy * cos,
    rotationDeg: normalizeDeg(2 * phiDeg - t.rotationDeg),
    mirrorY: !t.mirrorY,
  };
}

function selectionCentre(objects: ReadonlyArray<SceneObject>): Vec2 | null {
  const box = combinedBBox(objects);
  return box === null ? null : selectionAnchorPoint(box, 'c');
}

function normalizeDeg(deg: number): number {
  const normalized = deg % FULL_TURN_DEG;
  return normalized < 0 ? normalized + FULL_TURN_DEG : normalized;
}
