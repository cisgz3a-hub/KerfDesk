// applyTransform — turns a Vec2 in object-local coordinates into the scene's
// logical (pre-origin) coordinate frame using the SceneObject's transform.
//
// Order: scale → mirror → rotate around the local origin → translate.
// This matches LightBurn's behavior for nested transforms and produces the
// affine equivalent of [translate][rotate][mirror][scale] applied to a point.

import type { Transform, Vec2 } from './scene-object';

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
