// The objects Union Silhouette and Join Paths may rebuild (ADR-350 Amendment 2).
// Both replace their sources with new imported-svg objects built from stored
// outlines, so they take ADR-350 Amendment 1's 'replace' guard: variable text
// and variable barcodes keep their template, and the registration jig keeps its
// pieces. The menu gating, both dialogs, the material-library repair preview
// and the store actions all read the selection through this one function.

import { isVectorPathObject, type VectorSceneObject } from '../../core/geometry';
import type { Scene } from '../../core/scene';
import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
import {
  geometryToolSkippedNotice,
  geometryToolSources,
  type GeometryToolSkips,
} from './geometry-tool-sources';

export type VectorRepairSources = {
  /** The unlocked plain vector objects the tool rebuilds, in scene order. */
  readonly kept: ReadonlyArray<VectorSceneObject>;
  readonly skipped: GeometryToolSkips;
  /** What was left out, worded as Weld words it; empty when nothing was. */
  readonly notice: string;
};

/**
 * The selection split into what Union / Join rebuild and what they leave out,
 * or null when the selection holds anything else they cannot edit (a locked
 * object, a compound result, an image, a stale id). Objects the guard leaves
 * out never make the selection ineligible, so Select All still works.
 */
export function vectorRepairSources(
  scene: Scene,
  selectedIds: ReadonlyArray<string>,
): VectorRepairSources | null {
  const ids = new Set(selectedIds);
  const selected = scene.objects.filter((object) => ids.has(object.id));
  if (selected.length === 0 || selected.length !== ids.size) return null;
  const { kept, skipped } = geometryToolSources(scene, selected, 'replace');
  const editable = kept.filter(
    (object): object is VectorSceneObject =>
      object.locked !== true && !isBooleanCompoundObject(object) && isVectorPathObject(object),
  );
  if (editable.length !== kept.length) return null;
  return { kept: editable, skipped, notice: geometryToolSkippedNotice(skipped) };
}
