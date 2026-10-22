// A vector result the background worker already computed for a dialog's
// preview or a one-click command (ADR-609). An action commits it only when it
// was computed from exactly the inputs the action would use now: the same
// source objects (by identity, in order), the same options, and result ids the
// scene would still give (objectIdStillFree, which also accepts an unused
// random id once the numbered ones run out). The core calls are pure, so that
// result is the one the action would compute. Any mismatch, or no prepared
// result at all, computes in thread as before.

import {
  combineVectorObjects,
  offsetVectorObjects,
  type VectorBooleanOp,
  type VectorOpError,
  type VectorSceneObject,
} from '../../core/geometry';
import type { CutShapesError, CutShapesPlan } from '../../core/geometry/cut-shapes';
import type { OffsetShapesOptions, OffsetShapesResult } from '../../core/geometry/offset-shapes';
import {
  NOTHING_TO_WELD_MESSAGE,
  weldChangesOutlines,
} from '../../core/geometry/vector-path-weld-change';
import { err, ok, type Result } from '../../core/result';
import type { ImportedSvg, Scene } from '../../core/scene';
import {
  objectIdStillFree,
  uniqueObjectId,
  uniqueWeldId,
  WELD_ID_BASE,
} from './vector-path-selection';
import { planWeldSelection, type WeldSelectionPlan } from './vector-path-weld-plan';

export type PreparedOffsetShapes = {
  readonly sources: ReadonlyArray<VectorSceneObject>;
  readonly options: OffsetShapesOptions;
  readonly ids: { readonly outward: string; readonly inward: string };
  readonly result: OffsetShapesResult;
};

export type PreparedVectorCombine =
  | {
      readonly kind: 'combine';
      readonly sources: ReadonlyArray<VectorSceneObject>;
      readonly op: VectorBooleanOp;
      readonly object: ImportedSvg;
    }
  | {
      readonly kind: 'weld';
      /** A weld plan also clones operations, so it belongs to one exact scene. */
      readonly scene: Scene;
      readonly sources: ReadonlyArray<VectorSceneObject>;
      readonly plan: WeldSelectionPlan;
    };

/** A one-click command's background result, refusals included. */
export type PreparedOffsetPaths = {
  readonly sources: ReadonlyArray<VectorSceneObject>;
  readonly deltaMm: number;
  readonly id: string;
  readonly result: Result<ImportedSvg, VectorOpError>;
};

export type PreparedCutShapes = {
  /** New piece ids avoid every object id, so a plan belongs to one exact scene. */
  readonly scene: Scene;
  readonly sources: ReadonlyArray<VectorSceneObject>;
  readonly result: Result<CutShapesPlan, CutShapesError>;
};

export function sameSourceObjects(
  left: ReadonlyArray<VectorSceneObject>,
  right: ReadonlyArray<VectorSceneObject>,
): boolean {
  return left.length === right.length && left.every((object, index) => object === right[index]);
}

export function sameOffsetShapesOptions(
  left: OffsetShapesOptions,
  right: OffsetShapesOptions,
): boolean {
  return (
    Object.is(left.distanceMm, right.distanceMm) &&
    left.direction === right.direction &&
    left.cornerStyle === right.cornerStyle &&
    left.outerShapesOnly === right.outerShapesOnly
  );
}

export function reusableOffsetShapes(
  prepared: PreparedOffsetShapes | undefined,
  scene: Scene,
  sources: ReadonlyArray<VectorSceneObject>,
  options: OffsetShapesOptions,
): PreparedOffsetShapes | undefined {
  if (prepared === undefined) return undefined;
  const same =
    sameSourceObjects(prepared.sources, sources) &&
    sameOffsetShapesOptions(prepared.options, options) &&
    objectIdStillFree(scene, 'offset', prepared.ids.outward) &&
    objectIdStillFree(scene, 'offset-inward', prepared.ids.inward);
  return same ? prepared : undefined;
}

export function reusableCombine(
  prepared: PreparedVectorCombine | undefined,
  scene: Scene,
  sources: ReadonlyArray<VectorSceneObject>,
  op: VectorBooleanOp,
): ImportedSvg | undefined {
  if (prepared?.kind !== 'combine') return undefined;
  const same =
    prepared.op === op &&
    objectIdStillFree(scene, op, prepared.object.id) &&
    sameSourceObjects(prepared.sources, sources);
  return same ? prepared.object : undefined;
}

export function reusableWeld(
  prepared: PreparedVectorCombine | undefined,
  scene: Scene,
  sources: ReadonlyArray<VectorSceneObject>,
): WeldSelectionPlan | undefined {
  if (prepared?.kind !== 'weld') return undefined;
  const same =
    prepared.scene === scene &&
    objectIdStillFree(scene, WELD_ID_BASE, prepared.plan.object.id) &&
    sameSourceObjects(prepared.sources, sources);
  return same ? prepared.plan : undefined;
}

export function reusableOffsetPaths(
  prepared: PreparedOffsetPaths | undefined,
  scene: Scene,
  sources: ReadonlyArray<VectorSceneObject>,
  deltaMm: number,
): Result<ImportedSvg, VectorOpError> | undefined {
  if (prepared === undefined) return undefined;
  const same =
    Object.is(prepared.deltaMm, deltaMm) &&
    objectIdStillFree(scene, 'offset', prepared.id) &&
    sameSourceObjects(prepared.sources, sources);
  return same ? prepared.result : undefined;
}

export function reusableCutShapes(
  prepared: PreparedCutShapes | undefined,
  scene: Scene,
  sources: ReadonlyArray<VectorSceneObject>,
): Result<CutShapesPlan, CutShapesError> | undefined {
  if (prepared === undefined) return undefined;
  const same = prepared.scene === scene && sameSourceObjects(prepared.sources, sources);
  return same ? prepared.result : undefined;
}

/** Weld's plan for the selection: a matching background plan, else planned here. */
export function weldPlanForSelection(
  scene: Scene,
  selected: ReadonlyArray<VectorSceneObject>,
  background: PreparedVectorCombine | undefined,
): Result<WeldSelectionPlan, VectorOpError> {
  const reused = reusableWeld(background, scene, selected);
  const plan =
    reused === undefined ? planWeldSelection(scene, selected, uniqueWeldId(scene)) : ok(reused);
  // A weld that merges nothing would only flatten editable sources into one
  // path object with the same outlines, so it is refused like a failed weld.
  if (plan.kind === 'error' || weldChangesOutlines(selected, plan.value.object)) return plan;
  return err({ kind: 'nothing-to-weld', message: NOTHING_TO_WELD_MESSAGE });
}

/** Combine's result for the selection: a matching background result, else computed here. */
export function combineForSelection(
  scene: Scene,
  selected: ReadonlyArray<VectorSceneObject>,
  op: VectorBooleanOp,
  background: PreparedVectorCombine | undefined,
): Result<ImportedSvg, VectorOpError> {
  const reused = reusableCombine(background, scene, selected, op);
  return reused === undefined
    ? combineVectorObjects(selected, op, uniqueObjectId(scene, op))
    : ok(reused);
}

/** The Offset outlines result: a matching background result, else computed here. */
export function offsetOutlinesForSelection(
  scene: Scene,
  selected: ReadonlyArray<VectorSceneObject>,
  deltaMm: number,
  background: PreparedOffsetPaths | undefined,
): Result<ImportedSvg, VectorOpError> {
  return (
    reusableOffsetPaths(background, scene, selected, deltaMm) ??
    offsetVectorObjects(selected, deltaMm, uniqueObjectId(scene, 'offset'))
  );
}
