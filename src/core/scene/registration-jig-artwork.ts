import { findRegistrationBoxes } from './registration-layer';
import type { Scene } from './scene';
import type { SceneObject } from './scene-object';

const REGISTRATION_JIG_COPY_PREFIX = 'registration-jig-copy:';
const REGISTRATION_JIG_GROUP_COPY_PREFIX = 'registration-jig-group-copy:';

export type RegistrationJigArtworkInstance = {
  readonly boxId: string;
  readonly objects: ReadonlyArray<SceneObject>;
};

export type RegistrationJigCopyIdentity = {
  readonly sourceId: string;
  readonly boxId: string;
};

export function registrationJigCopyPrefix(sourceId: string): string {
  return `${REGISTRATION_JIG_COPY_PREFIX}${encodeURIComponent(sourceId)}:`;
}

export function registrationJigCopyId(sourceId: string, boxId: string): string {
  return `${registrationJigCopyPrefix(sourceId)}${encodeURIComponent(boxId)}`;
}

export function registrationJigGroupCopyPrefix(sourceGroupId: string): string {
  return `${REGISTRATION_JIG_GROUP_COPY_PREFIX}${encodeURIComponent(sourceGroupId)}:`;
}

export function registrationJigGroupCopyId(sourceGroupId: string, boxId: string): string {
  return `${registrationJigGroupCopyPrefix(sourceGroupId)}${encodeURIComponent(boxId)}`;
}

export function registrationJigCopyIdentity(objectId: string): RegistrationJigCopyIdentity | null {
  if (!objectId.startsWith(REGISTRATION_JIG_COPY_PREFIX)) return null;
  const encoded = objectId.slice(REGISTRATION_JIG_COPY_PREFIX.length);
  const separator = encoded.indexOf(':');
  if (separator <= 0 || separator === encoded.length - 1) return null;
  try {
    return {
      sourceId: decodeURIComponent(encoded.slice(0, separator)),
      boxId: decodeURIComponent(encoded.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

/** Returns the active jig artwork in physical outline order, one complete piece per entry. */
export function registrationJigArtworkInstances(
  scene: Scene,
): ReadonlyArray<RegistrationJigArtworkInstance> {
  const boxes = findRegistrationBoxes(scene);
  if (boxes.length < 2) return [];
  const boxIds = new Set(boxes.map((box) => box.id));
  const copies = scene.objects.flatMap((object) => {
    const identity = registrationJigCopyIdentity(object.id);
    return identity !== null && boxIds.has(identity.boxId) ? [{ object, identity }] : [];
  });
  if (copies.length === 0) return [];
  const sourceIds = new Set(copies.map(({ identity }) => identity.sourceId));
  const sourceObjects = scene.objects.filter((object) => sourceIds.has(object.id));
  const instances: RegistrationJigArtworkInstance[] = [];
  const firstBox = boxes[0];
  if (firstBox !== undefined && sourceObjects.length > 0) {
    instances.push({ boxId: firstBox.id, objects: sourceObjects });
  }
  for (const box of boxes.slice(1)) {
    const objects = copies
      .filter(({ identity }) => identity.boxId === box.id)
      .map(({ object }) => object);
    if (objects.length > 0) instances.push({ boxId: box.id, objects });
  }
  return instances;
}
