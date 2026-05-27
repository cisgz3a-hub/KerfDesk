// hitTest — given a point in scene-logical coordinates (mm), find the topmost
// SceneObject at that point. Pure: no DOM, no rendering. Used by the UI
// when the user clicks the canvas.
//
// Phase A approach: AABB hit test against each object's transformed bounding
// box. Phase A extended will tighten this with per-polyline distance tests
// so users can click closer to the line, not just inside the box.

import { applyTransform } from './transform';
import type { Scene } from './scene';
import type { SceneObject, Transform, Vec2 } from './scene-object';

export function hitTest(scene: Scene, point: Vec2): string | null {
  // Topmost first — later-added objects render on top so they take the click.
  for (let i = scene.objects.length - 1; i >= 0; i -= 1) {
    const obj = scene.objects[i];
    if (obj === undefined) continue;
    if (pointInObjectBBox(point, obj)) return obj.id;
  }
  return null;
}

function pointInObjectBBox(point: Vec2, obj: SceneObject): boolean {
  const bbox = transformedBBox(obj);
  return (
    point.x >= bbox.minX && point.x <= bbox.maxX && point.y >= bbox.minY && point.y <= bbox.maxY
  );
}

export type AABB = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export function transformedBBox(obj: SceneObject): AABB {
  // Apply the object's transform to its natural bounds corners, then take the
  // axis-aligned bounding box of the rotated rectangle.
  const corners: Vec2[] = [
    { x: obj.bounds.minX, y: obj.bounds.minY },
    { x: obj.bounds.maxX, y: obj.bounds.minY },
    { x: obj.bounds.maxX, y: obj.bounds.maxY },
    { x: obj.bounds.minX, y: obj.bounds.maxY },
  ];
  return aabbOfCorners(corners, obj.transform);
}

function aabbOfCorners(corners: ReadonlyArray<Vec2>, transform: Transform): AABB {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const c of corners) {
    const p = applyTransform(c, transform);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
