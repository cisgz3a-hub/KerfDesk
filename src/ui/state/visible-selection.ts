import type { Scene } from '../../core/scene';
import {
  sceneLayerVisibilityLookup,
  sceneObjectHasVisibleLayerFromMap,
} from '../../core/scene/visibility';

type Selection = {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

/** The selection without artwork that `scene` hides or locks, or null when
 * every selected artwork is still visible. Artwork an edit hides leaves the
 * selection, so Delete or a nudge cannot reach it unseen. */
export function selectionWithoutHidden(selection: Selection, scene: Scene): Selection | null {
  const lookup = sceneLayerVisibilityLookup(scene.layers);
  const byId = new Map(scene.objects.map((object) => [object.id, object]));
  const selected = [
    ...(selection.selectedObjectId === null ? [] : [selection.selectedObjectId]),
    ...selection.additionalSelectedIds,
  ];
  const visible = selected.filter((id) => {
    const object = byId.get(id);
    return (
      object !== undefined &&
      object.locked !== true &&
      sceneObjectHasVisibleLayerFromMap(object, lookup)
    );
  });
  if (visible.length === selected.length) return null;
  const [primary, ...rest] = visible;
  return { selectedObjectId: primary ?? null, additionalSelectedIds: new Set(rest) };
}
