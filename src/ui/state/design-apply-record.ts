// design-apply-record — what a previous Apply put into the scene (ADR-272,
// DS-8e). The Studio keeps this on its session so the NEXT Apply updates the
// artwork it already created instead of stacking a second copy beside it,
// which is what "go back and fix a mistake" has to mean.
//
// Objects are replaced wholesale — the sketch is the source of truth for that
// geometry — while the OPERATION is reused by id wherever it survives, so the
// feeds, passes, and tabs an operator tuned on the main canvas are not thrown
// away by a re-apply, and the operation keeps its name instead of gaining a
// "Layer 1 2" suffix.

import type { Scene } from '../../core/scene';

export type DesignApplyRecord = {
  readonly objectIds: ReadonlySet<string>;
  // Design layer id → the scene operation it created.
  readonly operationIdByLayerId: ReadonlyMap<string, string>;
};

export const EMPTY_APPLY_RECORD: DesignApplyRecord = {
  objectIds: new Set<string>(),
  operationIdByLayerId: new Map<string, string>(),
};

/**
 * The operation a design layer applied to last time, but only while it still
 * exists — the operator may have deleted it from the layers panel, in which
 * case the next Apply creates a fresh one.
 */
export function reusableOperationId(
  scene: Scene,
  record: DesignApplyRecord | null,
  layerId: string,
): string | null {
  const operationId = record?.operationIdByLayerId.get(layerId);
  if (operationId === undefined) return null;
  return scene.layers.some((layer) => layer.id === operationId) ? operationId : null;
}

/** Object ids from the previous apply that are still in the scene. */
export function survivingObjectIds(
  scene: Scene,
  record: DesignApplyRecord | null,
): ReadonlySet<string> {
  if (record === null || record.objectIds.size === 0) return EMPTY_APPLY_RECORD.objectIds;
  const alive = new Set<string>();
  for (const object of scene.objects) {
    if (record.objectIds.has(object.id)) alive.add(object.id);
  }
  return alive;
}
