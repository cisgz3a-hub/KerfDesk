import { findRegistrationBoxes } from './registration-layer';
import type { Scene } from './scene';
import type { SceneObject } from './scene-object';
import {
  MAX_REGISTRATION_JIG_ANCESTORS,
  type RegistrationJigIdentity,
} from './registration-jig-identity';

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

/** Legacy encoding stays readable; new deep parts carry ancestry separately. */
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

/** Read old projects without rewriting their object IDs or their external references. */
export function registrationJigObjectIdentity(object: SceneObject): RegistrationJigIdentity | null {
  if (object.registrationJig?.objectId === object.id) return object.registrationJig;
  const first = registrationJigCopyIdentity(object.id);
  if (first === null) return null;
  const ancestors: RegistrationJigIdentity['ancestors'][number][] = [];
  let ancestorId = object.id;
  for (;;) {
    const identity = registrationJigCopyIdentity(ancestorId);
    if (identity === null) break;
    ancestors.push({
      sourceId: identity.sourceId,
      kind: ancestorId.startsWith(REGISTRATION_JIG_COPY_PREFIX) ? 'copy' : 'part',
    });
    ancestorId = identity.sourceId;
  }
  return { objectId: object.id, boxId: first.boxId, ancestors };
}

export function withRegistrationJigBox<T extends SceneObject>(object: T, boxId: string): T {
  return {
    ...object,
    registrationJig: {
      objectId: object.id,
      boxId,
      ancestors: registrationJigObjectIdentity(object)?.ancestors ?? [],
    },
  };
}

export function withRegistrationJigChild<T extends SceneObject>(
  source: SceneObject,
  child: T,
  boxId: string,
  kind: 'copy' | 'part',
): T {
  return {
    ...child,
    registrationJig: {
      objectId: child.id,
      boxId,
      ancestors: [
        { sourceId: source.id, kind },
        ...(registrationJigObjectIdentity(source)?.ancestors ?? []),
      ],
    },
  };
}

/** Index the scene once, then allocate copies without rescanning unrelated artwork. */
export function createRegistrationJigCopyIdAllocator(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
): (sourceId: string, boxId: string) => string {
  const existingIds = new Set(scene.objects.map((object) => object.id));
  const reservedIds = new Set(selectedIds);
  const reusable = new Map<string, { ids: string[]; next: number }>();
  const key = (sourceId: string, boxId: string): string => JSON.stringify([sourceId, boxId]);
  for (const object of scene.objects) {
    const identity = registrationJigObjectIdentity(object);
    const parent = identity?.ancestors[0];
    if (identity === null || parent?.kind !== 'copy') continue;
    const entryKey = key(parent.sourceId, identity.boxId);
    const entry = reusable.get(entryKey) ?? { ids: [], next: 0 };
    entry.ids.push(object.id);
    reusable.set(entryKey, entry);
  }
  return (sourceId, boxId) => {
    const entry = reusable.get(key(sourceId, boxId));
    while (entry !== undefined && entry.next < entry.ids.length) {
      const id = entry.ids[entry.next++];
      if (id === undefined || reservedIds.has(id)) continue;
      reservedIds.add(id);
      return id;
    }
    let id = registrationJigCopyId(sourceId, boxId);
    while (id.length > 200 || reservedIds.has(id) || existingIds.has(id)) {
      id = 'registration-jig-copy-v2:' + crypto.randomUUID();
    }
    reservedIds.add(id);
    return id;
  };
}

export function registrationJigIdentityBudgetIssue(
  objects: ReadonlyArray<SceneObject>,
): string | null {
  return objects.some(
    (object) => (object.registrationJig?.ancestors.length ?? 0) > MAX_REGISTRATION_JIG_ANCESTORS,
  )
    ? 'This jig edit would exceed the saved project ancestry limit. Duplicate the artwork as a new source before creating another jig generation.'
    : null;
}

/** Reapplying a source replaces its copies and every edit extracted from those copies. */
export function registrationJigReplacedArtworkIds(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const removed = new Set<string>();
  for (const object of scene.objects) {
    if (selectedIds.has(object.id)) continue;
    for (const ancestor of registrationJigObjectIdentity(object)?.ancestors ?? []) {
      if (!selectedIds.has(ancestor.sourceId)) continue;
      if (ancestor.kind === 'copy') removed.add(object.id);
      break;
    }
  }
  return removed;
}

/** Returns the active jig artwork in physical outline order, one complete piece per entry. */
export function registrationJigArtworkInstances(
  scene: Scene,
): ReadonlyArray<RegistrationJigArtworkInstance> {
  const boxes = findRegistrationBoxes(scene);
  if (boxes.length === 0) return [];
  const boxIds = new Set(boxes.map((box) => box.id));
  const members = scene.objects.flatMap((object) => {
    const identity = registrationJigObjectIdentity(object);
    return identity !== null && boxIds.has(identity.boxId) ? [{ object, identity }] : [];
  });
  const firstBox = boxes[0];
  if (firstBox === undefined || members.length === 0) return [];
  const sourceIds = new Set(
    members.flatMap(({ identity }) =>
      identity.ancestors.slice(0, 1).map((ancestor) => ancestor.sourceId),
    ),
  );
  const layoutSourceIds = new Set(
    members.flatMap(({ identity }) =>
      identity.ancestors
        .filter((ancestor) => ancestor.kind === 'copy')
        .map((ancestor) => ancestor.sourceId),
    ),
  );
  const explicitBoxes = new Map(members.map(({ object, identity }) => [object.id, identity.boxId]));
  return boxes.flatMap((box) => {
    const objects = scene.objects.filter((object) => {
      // Explicit membership persists promotion even after every child is gone.
      const explicit =
        object.registrationJig?.objectId === object.id ? explicitBoxes.get(object.id) : undefined;
      const inferred = layoutSourceIds.has(object.id)
        ? firstBox.id
        : (explicitBoxes.get(object.id) ?? (sourceIds.has(object.id) ? firstBox.id : null));
      return (explicit ?? inferred) === box.id;
    });
    return objects.length === 0 ? [] : [{ boxId: box.id, objects }];
  });
}
