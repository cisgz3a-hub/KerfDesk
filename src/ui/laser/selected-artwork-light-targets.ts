import {
  artworkOperationName,
  isRegistrationBox,
  sceneLayerVisibility,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { registrationJigObjectIdentity } from '../../core/scene/registration-jig-artwork';
import { selectionUnits } from '../../core/scene/selection-units';
import { groupsWithinFocus } from '../state/design-hierarchy-store';
import { formatRoundedTo2Decimals } from '../../core/util/number-format';

export type ArtworkLightTarget = {
  readonly id: string;
  readonly label: string;
  readonly objectIds: ReadonlyArray<string>;
};

/** Match canvas grouping, while keeping separate jig copies independently selectable. */
export function selectedArtworkLightTargets(
  scene: Scene,
  ids: ReadonlyArray<string>,
  focusId: string | null = null,
): ReadonlyArray<ArtworkLightTarget> {
  const selected = new Set(ids);
  const visibility = sceneLayerVisibility.lookup(scene.layers);
  const copies = new Map<string, SceneObject[]>();
  for (const object of scene.objects) {
    if (
      !selected.has(object.id) ||
      isRegistrationBox(object) ||
      !sceneLayerVisibility.hasObject(object, visibility)
    )
      continue;
    const copy = registrationJigObjectIdentity(object)?.boxId ?? '';
    const objects = copies.get(copy) ?? [];
    objects.push(object);
    copies.set(copy, objects);
  }
  const groups = groupsWithinFocus(scene.groups ?? [], focusId);
  return [...copies.values()].flatMap((objects) =>
    selectionUnits(objects, groups).map((unit) => {
      const objectIds = unit.objects.map((object) => object.id);
      const members = new Set(objectIds);
      const group = groups.find(
        (candidate) =>
          candidate.objectIds.length === members.size &&
          candidate.objectIds.every((id) => members.has(id)),
      );
      const first = unit.objects[0];
      const name =
        group?.name ??
        (unit.objects.length === 1 && first !== undefined
          ? artworkOperationName(first)
          : 'Group (' + unit.objects.length + ' artworks)');
      const width = formatRoundedTo2Decimals(unit.box.maxX - unit.box.minX);
      const height = formatRoundedTo2Decimals(unit.box.maxY - unit.box.minY);
      return {
        id: JSON.stringify(objectIds),
        objectIds,
        label: name + ' · ' + width + ' × ' + height + ' mm',
      };
    }),
  );
}
