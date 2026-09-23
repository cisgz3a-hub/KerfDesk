// job-review-operation-edit — makes a Job Review operation row show and change
// the settings compile will actually use.
//
// ADR-317: an artwork's own value for an operation field replaces the
// operation's base value. Traced artwork carries such an override from import
// (its fill style), and Artwork-panel edits on it land in the override. The
// Job Review row read and wrote only the operation base, so an operator who
// changed Speed there saw the new number while that artwork kept running at
// its own speed (controller audit 2026-09-23, speed-2). A row edit now also
// reaches every artwork on the operation that owns the edited field, and the
// row shows the artworks' value whenever they all agree on it.

import {
  effectiveOperationForObject,
  operationOverrideForObject,
} from '../../../core/effective-output';
import {
  sceneObjectUsesOperation,
  type Layer,
  type LayerOperationSettings,
  type SceneObject,
} from '../../../core/scene';

const ROW_FIELDS = ['power', 'minPower', 'speed', 'passes', 'airAssist'] as const;
type RowField = (typeof ROW_FIELDS)[number];
export type ReviewRowPatch = Partial<Pick<LayerOperationSettings, RowField>>;

/** The operation with each row field replaced by the value every artwork on it
 * runs, when they agree. Mixed or artwork-free fields keep the base value. */
export function reviewRowSettings(layer: Layer, objects: ReadonlyArray<SceneObject>): Layer {
  const effective = objects
    .filter((object) => sceneObjectUsesOperation(object, layer))
    .map((object) => effectiveOperationForObject(layer, object));
  const first = effective[0];
  if (first === undefined) return layer;
  const agreed: Record<string, unknown> = {};
  for (const field of ROW_FIELDS) {
    if (effective.every((settings) => settings[field] === first[field])) {
      agreed[field] = first[field];
    }
  }
  return { ...layer, ...(agreed as ReviewRowPatch) };
}

export type ArtworkOwnerPatch = {
  readonly objectIds: ReadonlyArray<string>;
  readonly patch: ReviewRowPatch;
};

/** The artworks on `layer` whose own settings own a field in `patch`, grouped
 * by the part of the patch they own, so an owner never gains a field it did
 * not already hold. */
export function artworkOwnerPatches(
  layer: Layer,
  objects: ReadonlyArray<SceneObject>,
  patch: ReviewRowPatch,
): ReadonlyArray<ArtworkOwnerPatch> {
  const groups = new Map<
    string,
    { readonly objectIds: string[]; readonly patch: ReviewRowPatch }
  >();
  for (const object of objects) {
    if (!sceneObjectUsesOperation(object, layer)) continue;
    const override = operationOverrideForObject(layer, object);
    if (override === undefined) continue;
    const owned = Object.fromEntries(
      Object.entries(patch).filter(
        ([field]) => field in override && override[field as RowField] !== undefined,
      ),
    ) as ReviewRowPatch;
    const key = Object.keys(owned).sort().join(',');
    if (key === '') continue;
    const group = groups.get(key) ?? { objectIds: [], patch: owned };
    group.objectIds.push(object.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}
