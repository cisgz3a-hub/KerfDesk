import { findRegistrationBoxes } from './registration-layer';
import type { Scene } from './scene';
import type { SceneObject } from './scene-object';

const REGISTRATION_JIG_COPY_PREFIX = 'registration-jig-copy:';
const REGISTRATION_JIG_PART_PREFIX = 'registration-jig-part:';
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

/** A detached part keeps an explicit physical instance, including the first outline. */
export function registrationJigPartId(sourceId: string, boxId: string, partKey: string): string {
  return `${REGISTRATION_JIG_PART_PREFIX}${encodeURIComponent(sourceId)}:${encodeURIComponent(boxId)}:${encodeURIComponent(partKey)}`;
}

export function registrationJigGroupCopyPrefix(sourceGroupId: string): string {
  return `${REGISTRATION_JIG_GROUP_COPY_PREFIX}${encodeURIComponent(sourceGroupId)}:`;
}

export function registrationJigGroupCopyId(sourceGroupId: string, boxId: string): string {
  return `${registrationJigGroupCopyPrefix(sourceGroupId)}${encodeURIComponent(boxId)}`;
}

export function registrationJigCopyIdentity(objectId: string): RegistrationJigCopyIdentity | null {
  if (objectId.startsWith(REGISTRATION_JIG_PART_PREFIX)) {
    const fields = objectId.slice(REGISTRATION_JIG_PART_PREFIX.length).split(':');
    if (fields.length !== 3 || fields.some((field) => field.length === 0)) return null;
    try {
      const [sourceId, boxId] = fields.map(decodeURIComponent);
      if (sourceId === undefined || boxId === undefined) return null;
      return { sourceId, boxId };
    } catch {
      return null;
    }
  }
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

/** Reapplying a source replaces its copies and every edit extracted from those copies. */
export function registrationJigReplacedArtworkIds(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const removed = new Set<string>();
  for (const object of scene.objects) {
    if (selectedIds.has(object.id)) continue;
    // Decode ancestry even if the operator already deleted a copied remainder.
    // The nested source string gets shorter on every iteration.
    let ancestorId = object.id;
    for (;;) {
      const identity = registrationJigCopyIdentity(ancestorId);
      if (identity === null) break;
      if (
        ancestorId.startsWith(REGISTRATION_JIG_COPY_PREFIX) &&
        selectedIds.has(identity.sourceId)
      ) {
        removed.add(object.id);
        break;
      }
      if (selectedIds.has(identity.sourceId)) break;
      ancestorId = identity.sourceId;
    }
  }
  return removed;
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
  const layoutSourceIds = new Set<string>();
  for (const { object } of copies) {
    // A detached part retains the copy's lineage even after its remainder is gone.
    // Only copy links establish a first-outline source; part links keep their box.
    let ancestorId = object.id;
    for (;;) {
      const identity = registrationJigCopyIdentity(ancestorId);
      if (identity === null) break;
      if (ancestorId.startsWith(REGISTRATION_JIG_COPY_PREFIX)) {
        layoutSourceIds.add(identity.sourceId);
      }
      ancestorId = identity.sourceId;
    }
  }
  const explicitBoxes = new Map(copies.map(({ object, identity }) => [object.id, identity.boxId]));
  const firstBox = boxes[0];
  if (firstBox === undefined) return [];
  return boxes.flatMap((box) => {
    // A source deliberately copied across the jig starts at the first outline.
    // Merely extracting a part does not change its parent's physical instance.
    const objects = scene.objects.filter(
      (object) =>
        (layoutSourceIds.has(object.id)
          ? firstBox.id
          : (explicitBoxes.get(object.id) ?? (sourceIds.has(object.id) ? firstBox.id : null))) ===
        box.id,
    );
    return objects.length === 0 ? [] : [{ boxId: box.id, objects }];
  });
}
