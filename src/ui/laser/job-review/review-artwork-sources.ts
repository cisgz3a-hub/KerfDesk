import type { SceneObject } from '../../../core/scene';

/** A bounded content fingerprint rather than an ID-only claim or a second copy
 * of potentially large canonical geometry in the review model. */
export type ReviewArtworkSource = {
  readonly objectId: string;
  readonly contentKey: string;
};

export function reviewArtworkSources(
  objects: ReadonlyArray<SceneObject>,
): ReadonlyArray<ReviewArtworkSource> {
  return objects.map((object) => ({ objectId: object.id, contentKey: contentKey(object) }));
}

export function matchingReviewArtworkIds(
  sources: ReadonlyArray<ReviewArtworkSource>,
  objects: ReadonlyArray<SceneObject>,
): ReadonlyArray<string> {
  const current = new Map(objects.map((object) => [object.id, object]));
  return sources.flatMap((source) => {
    const object = current.get(source.objectId);
    return object !== undefined && contentKey(object) === source.contentKey ? [object.id] : [];
  });
}

function contentKey(object: SceneObject): string {
  const serialized = JSON.stringify(object);
  // Two independently seeded 32-bit accumulators plus the input length keep
  // the model bounded across worker clones and distinguish same-ID edits.
  // This is correspondence for advisory navigation, not execution authority.
  let first = 0x811c9dc5;
  let second = 5381;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second, 33) ^ code;
  }
  return serialized.length + ':' + first.toString(16) + ':' + (second >>> 0).toString(16);
}
