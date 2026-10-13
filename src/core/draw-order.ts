// Change Draw Order (LightBurn "Push" tools). Canvas stacking follows
// `scene.objects`: later objects render on top and win hit tests. Machine
// output follows `artworkOrder`, whose missing entries fall back to the
// `objects` order, so the current output order is pinned before restacking.
// Changing what is drawn on top therefore never changes what is cut first.

import { canonicalArtworkOrder } from './artwork-order';
import type { Scene } from './scene';

export type DrawOrderMove = 'front' | 'forward' | 'backward' | 'back';

/** Restacks the objects in `ids`, keeping their order relative to one another. */
export function moveObjectsInDrawOrder(
  scene: Scene,
  ids: ReadonlySet<string>,
  move: DrawOrderMove,
): Scene {
  const objects = restack(scene.objects, (object) => ids.has(object.id), move);
  if (objects.every((object, index) => object === scene.objects[index])) return scene;
  return { ...scene, objects, artworkOrder: canonicalArtworkOrder(scene) };
}

function restack<T>(
  items: ReadonlyArray<T>,
  selected: (item: T) => boolean,
  move: DrawOrderMove,
): T[] {
  if (move === 'front')
    return [...items.filter((item) => !selected(item)), ...items.filter(selected)];
  if (move === 'back')
    return [...items.filter(selected), ...items.filter((item) => !selected(item))];
  const next = [...items];
  if (move === 'forward') {
    for (let index = next.length - 2; index >= 0; index -= 1)
      swapIfRising(next, index, index + 1, selected);
  } else {
    for (let index = 1; index < next.length; index += 1)
      swapIfRising(next, index, index - 1, selected);
  }
  return next;
}

// Moves the selected item at `from` past its unselected neighbour at `to`, so
// a run of selected items steps together and never jumps a selected one.
function swapIfRising<T>(
  items: T[],
  from: number,
  to: number,
  selected: (item: T) => boolean,
): void {
  const item = items[from];
  const neighbour = items[to];
  if (item === undefined || neighbour === undefined) return;
  if (!selected(item) || selected(neighbour)) return;
  items[from] = neighbour;
  items[to] = item;
}
