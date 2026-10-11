import type { Scene } from '../../core/scene';
import type { TracedImage } from '../../core/scene';
import {
  registrationJigArtworkInstances,
  registrationJigObjectIdentity,
  registrationJigPartId,
  withRegistrationJigChild,
} from '../../core/scene/registration-jig-artwork';

/** Preserve the selected physical workpiece instead of suffixing its encoded box ID. */
export function tracePartObjectId(scene: Scene, sourceId: string): string {
  const boxId = tracePartBox(scene, sourceId);
  const ids = new Set(scene.objects.map((object) => object.id));
  const candidate = (key: string): string =>
    boxId === undefined ? `${sourceId}__part_${key}` : registrationJigPartId(sourceId, boxId, key);
  for (let index = 1; index <= ids.size + 1; index += 1) {
    const id = candidate(String(index));
    if (id.length > 200) break;
    if (!ids.has(id)) return id;
  }
  let id: string;
  do {
    id = `trace-part:${crypto.randomUUID()}`;
  } while (ids.has(id));
  return id;
}

export function withTracePartJigIdentity(
  scene: Scene,
  source: TracedImage,
  part: TracedImage,
): TracedImage {
  const boxId = tracePartBox(scene, source.id);
  return boxId === undefined ? part : withRegistrationJigChild(source, part, boxId, 'part');
}

function tracePartBox(scene: Scene, sourceId: string): string | undefined {
  const source = scene.objects.find((object) => object.id === sourceId);
  return (
    registrationJigArtworkInstances(scene).find((instance) =>
      instance.objects.some((object) => object.id === sourceId),
    )?.boxId ?? (source === undefined ? undefined : registrationJigObjectIdentity(source)?.boxId)
  );
}
