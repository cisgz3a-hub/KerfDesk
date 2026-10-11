import type { Scene } from '../../core/scene';
import {
  registrationJigArtworkInstances,
  registrationJigCopyIdentity,
  registrationJigPartId,
} from '../../core/scene/registration-jig-artwork';

/** Preserve the selected physical workpiece instead of suffixing its encoded box ID. */
export function tracePartObjectId(scene: Scene, sourceId: string): string {
  const boxId =
    registrationJigArtworkInstances(scene).find((instance) =>
      instance.objects.some((object) => object.id === sourceId),
    )?.boxId ?? registrationJigCopyIdentity(sourceId)?.boxId;
  const ids = new Set(scene.objects.map((object) => object.id));
  const candidate = (key: string): string =>
    boxId === undefined ? `${sourceId}__part_${key}` : registrationJigPartId(sourceId, boxId, key);
  for (let index = 1; index <= ids.size + 1; index += 1) {
    const id = candidate(String(index));
    if (!ids.has(id)) return id;
  }
  return candidate(crypto.randomUUID());
}
