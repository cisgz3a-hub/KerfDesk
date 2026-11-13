import { refuseSceneLimitOverrun } from './scene-copy-room';
import { isVectorPathObject, type VectorSceneObject } from '../../core/geometry';
import type { ImportedSvg, Scene, SceneObject } from '../../core/scene';
import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
import { pruneDesignTreeOrder } from '../../core/scene/design-hierarchy-order';
import { useToastStore } from './toast-store';
import { selectedObjectIds } from './scene-group-actions';
import {
  geometryToolSkippedNotice,
  geometryToolSources,
  type GeometryToolGuard,
} from './geometry-tool-sources';
import type { VectorCombineOptions, VectorPathState } from './vector-path-actions';
export function replaceSelectedAtEarliest(
  objects: ReadonlyArray<SceneObject>,
  removeIds: ReadonlySet<string>,
  replacement: SceneObject,
): ReadonlyArray<SceneObject> {
  let inserted = false;
  return objects.flatMap((object) => {
    if (!removeIds.has(object.id)) return [object];
    if (inserted) return [];
    inserted = true;
    return [replacement];
  });
}

export function replaceIdsAtEarliest(
  ids: ReadonlyArray<string>,
  removeIds: ReadonlySet<string>,
  replacementId: string,
): ReadonlyArray<string> {
  let inserted = false;
  return ids.flatMap((id) => {
    if (!removeIds.has(id)) return [id];
    if (inserted) return [];
    inserted = true;
    return [replacementId];
  });
}

/**
 * The selected vector objects a geometry tool works on. With a `guard`, the
 * objects it must not rebuild are left out and, unless `notify` is false, a
 * notice says so (ADR-350 Amendment 1).
 */
export function selectedVectorObjects(
  scene: Scene,
  selectedIds: ReadonlyArray<string>,
  guard?: GeometryToolGuard,
  notify = true,
): ReadonlyArray<VectorSceneObject> {
  const selected = new Set(selectedIds);
  const objects = scene.objects.filter(
    (object): object is VectorSceneObject => selected.has(object.id) && isVectorPathObject(object),
  );
  if (objects.some(isBooleanCompoundObject)) {
    useToastStore
      .getState()
      .pushToast(
        'Edit compound sources or Expand the compound before editing its result geometry.',
        'warning',
      );
    return [];
  }
  if (guard === undefined) return objects;
  const { kept, skipped } = geometryToolSources(scene, objects, guard);
  const notice = notify ? geometryToolSkippedNotice(skipped) : '';
  if (notice !== '') useToastStore.getState().pushToast(notice, 'info');
  return kept;
}

export function expectedSelection(state: VectorPathState, options: VectorCombineOptions): boolean {
  if (options.keepOperands === true && options.retainCompound === true) return false;
  if (options.isCurrent?.() === false) return false;
  if (options.expectedProject !== undefined && options.expectedProject !== state.project)
    return false;
  if (options.expectedIds === undefined) return true;
  const ids = selectedObjectIds(state);
  return (
    ids.length === options.expectedIds.length && options.expectedIds.every((id) => ids.includes(id))
  );
}

export const WELD_ID_BASE = 'welded';

export function uniqueWeldId(scene: Scene): string {
  return uniqueObjectId(scene, WELD_ID_BASE);
}

export function uniqueObjectId(scene: Scene, base: string): string {
  return numberedObjectId(scene, base) ?? `${base}-paths-${crypto.randomUUID()}`;
}

/**
 * Whether `id` is the id uniqueObjectId would give in this scene: the numbered
 * one, or, once those run out, any unused random one. A background result
 * computed with that id can then be committed as it is (ADR-609).
 */
export function objectIdStillFree(scene: Scene, base: string, id: string): boolean {
  const numbered = numberedObjectId(scene, base);
  if (numbered !== null) return id === numbered;
  return id.startsWith(`${base}-paths-`) && !scene.objects.some((object) => object.id === id);
}

function numberedObjectId(scene: Scene, base: string): string | null {
  const used = new Set(scene.objects.map((object) => object.id));
  if (!used.has(`${base}-paths`)) return `${base}-paths`;
  for (let index = 2; index <= MAX_ID_SUFFIX; index += 1) {
    const id = `${base}-paths-${index}`;
    if (!used.has(id)) return id;
  }
  return null;
}

const MAX_ID_SUFFIX = 1000;

export function placeRetainedCompound(
  original: Scene,
  current: Scene,
  removed: ReadonlySet<string>,
  result: ImportedSvg,
  retained: boolean,
): Scene {
  if (!retained) return current;
  return pruneDesignTreeOrder({
    ...current,
    objects: replaceSelectedAtEarliest(original.objects, removed, result),
    ...(original.artworkOrder === undefined
      ? {}
      : { artworkOrder: replaceIdsAtEarliest(original.artworkOrder, removed, result.id) }),
  });
}

export function compoundSceneBudgetIsValid(
  before: Scene,
  after: Scene,
  retained: boolean,
): boolean {
  return (
    !retained ||
    !refuseSceneLimitOverrun(
      before,
      after,
      'Use fewer compound source fragments, or delete artwork first.',
    )
  );
}
