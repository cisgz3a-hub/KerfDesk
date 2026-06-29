import {
  sceneObjectHasVisibleLayer,
  transformedBBox,
  type AABB,
  type Scene,
  type Vec2,
} from '../../core/scene';

export function selectObjectsInMarquee(
  scene: Scene,
  start: Vec2,
  end: Vec2,
): ReadonlyArray<string> {
  const marquee = normalizedAabb(start, end);
  return scene.objects
    .filter((object) => object.locked !== true)
    .filter((object) => sceneObjectHasVisibleLayer(scene, object))
    .filter((object) => aabbIntersects(marquee, transformedBBox(object)))
    .map((object) => object.id);
}

function normalizedAabb(start: Vec2, end: Vec2): AABB {
  return {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  };
}

function aabbIntersects(a: AABB, b: AABB): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
