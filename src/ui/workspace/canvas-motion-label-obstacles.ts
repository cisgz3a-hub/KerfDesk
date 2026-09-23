import { sceneLayerVisibility, transformedBBox, type AABB, type Scene } from '../../core/scene';
import type { MarkerBox } from './canvas-motion-marker-layout';
import { ROTATE_HANDLE_OFFSET_MM } from './rotate-handle';
import type { ViewTransform } from './view-transform';

const ARTWORK_CLEARANCE_PX = 6;
const SELECTION_CLEARANCE_PX = 9;

/** Conservative four-corner footprints; never flatten or traverse path points. */
export function canvasStartLabelObstacles(
  scene: Scene,
  view: ViewTransform,
  selectedId: string | null,
  additionalSelectedIds: ReadonlySet<string>,
): ReadonlyArray<MarkerBox> {
  const lookup = sceneLayerVisibility.lookup(scene.layers);
  const obstacles: MarkerBox[] = [];
  let selection: AABB | null = null;
  for (const object of scene.objects) {
    if (!sceneLayerVisibility.hasObject(object, lookup)) continue;
    const bounds = transformedBBox(object);
    obstacles.push(screenBox(bounds, view, ARTWORK_CLEARANCE_PX));
    if (object.id !== selectedId && !additionalSelectedIds.has(object.id)) continue;
    selection = unionBounds(selection, bounds);
  }
  if (selection !== null) {
    // The combined frame and its fixed-pixel resize/move handles may span the
    // otherwise blank gap between separately selected objects.
    obstacles.push(screenBox(selection, view, SELECTION_CLEARANCE_PX));
    const middle = (selection.minX + selection.maxX) / 2;
    obstacles.push(
      screenBox(
        {
          minX: middle,
          maxX: middle,
          minY: selection.minY - ROTATE_HANDLE_OFFSET_MM,
          maxY: selection.minY,
        },
        view,
        SELECTION_CLEARANCE_PX,
      ),
    );
  }
  return obstacles;
}

function unionBounds(left: AABB | null, right: AABB): AABB {
  return left === null
    ? right
    : {
        minX: Math.min(left.minX, right.minX),
        minY: Math.min(left.minY, right.minY),
        maxX: Math.max(left.maxX, right.maxX),
        maxY: Math.max(left.maxY, right.maxY),
      };
}

function screenBox(bounds: AABB, view: ViewTransform, padding: number): MarkerBox {
  return {
    x: view.offsetX + bounds.minX * view.scale - padding,
    y: view.offsetY + bounds.minY * view.scale - padding,
    width: (bounds.maxX - bounds.minX) * view.scale + padding * 2,
    height: (bounds.maxY - bounds.minY) * view.scale + padding * 2,
  };
}
