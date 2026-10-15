import {
  findRegistrationBoxes,
  transformedBBox,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import {
  registrationJigArtworkInstances,
  registrationJigObjectIdentity,
} from '../../core/scene/registration-jig-artwork';
import { reliefAuthoringLinkIds } from '../../core/relief/relief-authoring-link-ids';
import { pruneOrphanLayers } from './scene-mutations';
import { removeObjectIdsFromGroups } from './scene-group-actions';
import { repairDanglingObjectDependencies, reportDependencyRepairs } from './object-delete-actions';

export type RemovedJigArtworkPolicy = 'keep' | 'remove';

/** Use persisted membership, including legacy first-slot inference, never geometric overlap. */
function artworkSlots(scene: Scene): ReadonlyMap<string, string> {
  const slots = new Map(
    registrationJigArtworkInstances(scene).flatMap((instance) =>
      instance.objects.map((object) => [object.id, instance.boxId] as const),
    ),
  );
  const boxIds = new Set(findRegistrationBoxes(scene).map((box) => box.id));
  for (const object of scene.objects) {
    const identity = registrationJigObjectIdentity(object);
    if (!slots.has(object.id) && identity !== null && boxIds.has(identity.boxId)) {
      slots.set(object.id, identity.boxId);
    }
  }
  return slots;
}

export function removedJigArtworkIds(scene: Scene, nextCount: number): ReadonlySet<string> {
  const removedBoxes = new Set(
    findRegistrationBoxes(scene)
      .slice(nextCount)
      .map((box) => box.id),
  );
  if (removedBoxes.size === 0) return new Set();
  return new Set(
    [...artworkSlots(scene)].filter(([, box]) => removedBoxes.has(box)).map(([id]) => id),
  );
}

export function removedJigArtworkIssue(scene: Scene, nextCount: number): string | null {
  const removed = new Set([
    ...removedJigArtworkIds(scene, nextCount),
    ...findRegistrationBoxes(scene)
      .slice(nextCount)
      .map((box) => box.id),
  ]);
  const linked = scene.objects.some(
    (object) =>
      !removed.has(object.id) &&
      object.kind === 'relief' &&
      'reliefAuthoring' in object &&
      object.reliefAuthoring !== undefined &&
      reliefAuthoringLinkIds(object.reliefAuthoring).some((id) => removed.has(id)),
  );
  return linked
    ? 'Artwork in a removed slot is used by a retained relief. Keep that artwork, or remove its linked use in the relief editor first.'
    : null;
}

/** One fixture edit moves linked members, including locked ones, without resizing artwork. */
export function relayoutRegistrationJigArtwork(
  before: Scene,
  after: Scene,
  policy: RemovedJigArtworkPolicy,
): Scene {
  const previousBoxes = new Map(findRegistrationBoxes(before).map((box) => [box.id, box]));
  const nextBoxes = new Map(findRegistrationBoxes(after).map((box) => [box.id, box]));
  const slots = artworkSlots(before);
  const removedIds = new Set<string>();
  const retiredSlots = new Map<string, string>();
  const objects = after.objects.flatMap((object): SceneObject[] => {
    const boxId = slots.get(object.id);
    if (boxId === undefined) return [object];
    const oldBox = previousBoxes.get(boxId);
    const nextBox = nextBoxes.get(boxId);
    if (nextBox === undefined) {
      if (policy === 'remove') {
        removedIds.add(object.id);
        return [];
      }
      // Keep artwork IDs and external references stable while retiring membership.
      // A fresh slot identity cannot reconnect when registration-box is reused.
      const retiredId = retiredSlots.get(boxId) ?? `retired-jig:${crypto.randomUUID()}`;
      retiredSlots.set(boxId, retiredId);
      return [
        { ...object, registrationJig: { objectId: object.id, boxId: retiredId, ancestors: [] } },
      ];
    }
    if (oldBox === undefined) return [object];
    const oldBounds = transformedBBox(oldBox);
    const nextBounds = transformedBBox(nextBox);
    const dx = (nextBounds.minX + nextBounds.maxX - oldBounds.minX - oldBounds.maxX) / 2;
    const dy = (nextBounds.minY + nextBounds.maxY - oldBounds.minY - oldBounds.maxY) / 2;
    return [
      {
        ...object,
        registrationJig: {
          objectId: object.id,
          boxId,
          ancestors: registrationJigObjectIdentity(object)?.ancestors ?? [],
        },
        transform: { ...object.transform, x: object.transform.x + dx, y: object.transform.y + dy },
      },
    ];
  });
  const scene = {
    ...after,
    objects,
    ...(after.artworkOrder === undefined
      ? {}
      : {
          artworkOrder: after.artworkOrder.filter((id) => !removedIds.has(id)),
        }),
  };
  if (removedIds.size === 0) return scene;
  const repaired = repairDanglingObjectDependencies(removeObjectIdsFromGroups(scene, removedIds));
  reportDependencyRepairs(repaired);
  return pruneOrphanLayers(repaired.scene);
}
