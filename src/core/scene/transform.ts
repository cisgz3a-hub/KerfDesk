// applyTransform — turns a Vec2 in object-local coordinates into the scene's
// logical (pre-origin) coordinate frame using the SceneObject's transform.
//
// Order: scale → mirror → rotate around the local origin → translate.
// This matches LightBurn's behavior for nested transforms and produces the
// affine equivalent of [translate][rotate][mirror][scale] applied to a point.

import type { Bounds, SceneObject, Transform, Vec2 } from './scene-object';

export function applyTransform(p: Vec2, t: Transform): Vec2 {
  let x = p.x * t.scaleX;
  let y = p.y * t.scaleY;
  if (t.mirrorX) x = -x;
  if (t.mirrorY) y = -y;
  const rad = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const xr = x * cos - y * sin;
  const yr = x * sin + y * cos;
  return { x: xr + t.x, y: yr + t.y };
}

export function flipTransformAboutCenter(
  object: SceneObject,
  axis: 'horizontal' | 'vertical',
): Transform {
  const center = boundsCenter(object.bounds);
  const before = applyTransform(center, object.transform);
  const flipped: Transform = {
    ...object.transform,
    mirrorX: axis === 'horizontal' ? !object.transform.mirrorX : object.transform.mirrorX,
    mirrorY: axis === 'vertical' ? !object.transform.mirrorY : object.transform.mirrorY,
  };
  const after = applyTransform(center, flipped);
  return {
    ...flipped,
    x: flipped.x + before.x - after.x,
    y: flipped.y + before.y - after.y,
  };
}

function boundsCenter(bounds: Bounds): Vec2 {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}
