import {
  sceneObjectHasVisibleLayer,
  transformedBBox,
  type AABB,
  type Scene,
  type Vec2,
} from '../../core/scene';
import { segmentBox, boxesOverlap } from '../../core/geometry/box-math';

// Directional marquee, matching LightBurn (study §6.1): dragging LEFT→RIGHT is
// an ENCLOSING (window) select — only objects fully inside the box — while
// dragging RIGHT→LEFT is a CROSSING select — objects inside OR merely touched.
// Direction is keyed on the horizontal sign of the drag (audit C3).
export function selectObjectsInMarquee(
  scene: Scene,
  start: Vec2,
  end: Vec2,
): ReadonlyArray<string> {
  const marquee = segmentBox(start, end);
  const enclosing = end.x >= start.x;
  return scene.objects
    .filter((object) => object.locked !== true)
    .filter((object) => sceneObjectHasVisibleLayer(scene, object))
    .filter((object) => {
      const bbox = transformedBBox(object);
      return enclosing ? aabbContains(marquee, bbox) : boxesOverlap(marquee, bbox);
    })
    .map((object) => object.id);
}

// True when `inner` sits entirely within `outer`.
function aabbContains(outer: AABB, inner: AABB): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.maxX >= inner.maxX &&
    outer.minY <= inner.minY &&
    outer.maxY >= inner.maxY
  );
}
