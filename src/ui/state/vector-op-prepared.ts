// A vector result the background worker already computed for a dialog's
// preview or a one-click command (ADR-609). An action commits it only when it was computed from
// exactly the inputs the action would use now: the same source objects (by
// identity, in order), the same options and the same result ids. The core
// calls are pure, so that result is the one the action would compute. Any
// mismatch, or no prepared result at all, computes in thread as before.

import {
  combineVectorObjects,
  offsetVectorObjects,
  type VectorBooleanOp,
  type VectorOpError,
  type VectorSceneObject,
} from '../../core/geometry';
import type { CutShapesError, CutShapesPlan } from '../../core/geometry/cut-shapes';
import type { OffsetShapesOptions, OffsetShapesResult } from '../../core/geometry/offset-shapes';
import { ok, type Result } from '../../core/result';
import type { ImportedSvg, Scene } from '../../core/scene';
import { uniqueObjectId, uniqueWeldId } from './vector-path-selection';
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
  sources: ReadonlyArray<VectorSceneObject>,
  options: OffsetShapesOptions,
  ids: { readonly outward: string; readonly inward: string },
): OffsetShapesResult | undefined {
  if (prepared === undefined) return undefined;
  const same =
    sameSourceObjects(prepared.sources, sources) &&
    sameOffsetShapesOptions(prepared.options, options) &&
    prepared.ids.outward === ids.outward &&
    prepared.ids.inward === ids.inward;
  return same ? prepared.result : undefined;
}

export function reusableCombine(
  prepared: PreparedVectorCombine | undefined,
  sources: ReadonlyArray<VectorSceneObject>,
  op: VectorBooleanOp,
  id: string,
): ImportedSvg | undefined {
  if (prepared?.kind !== 'combine') return undefined;
  const same =
    prepared.op === op && prepared.object.id === id && sameSourceObjects(prepared.sources, sources);
  return same ? prepared.object : undefined;
}

export function reusableWeld(
  prepared: PreparedVectorCombine | undefined,
  scene: Scene,
  sources: ReadonlyArray<VectorSceneObject>,
  id: string,
): WeldSelectionPlan | undefined {
  if (prepared?.kind !== 'weld') return undefined;
  const same =
    prepared.scene === scene &&
    prepared.plan.object.id === id &&
    sameSourceObjects(prepared.sources, sources);
  return same ? prepared.plan : undefined;
}

export function reusableOffsetPaths(
  prepared: PreparedOffsetPaths | undefined,
  sources: ReadonlyArray<VectorSceneObject>,
  deltaMm: number,
  id: string,
): Result<ImportedSvg, VectorOpError> | undefined {
  if (prepared === undefined) return undefined;
  const same =
    Object.is(prepared.deltaMm, deltaMm) &&
    prepared.id === id &&
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
  const id = uniqueWeldId(scene);
  const reused = reusableWeld(background, scene, selected, id);
  return reused === undefined ? planWeldSelection(scene, selected, id) : ok(reused);
}

/** Combine's result for the selection: a matching background result, else computed here. */
export function combineForSelection(
  scene: Scene,
  selected: ReadonlyArray<VectorSceneObject>,
  op: VectorBooleanOp,
  background: PreparedVectorCombine | undefined,
): Result<ImportedSvg, VectorOpError> {
  const id = uniqueObjectId(scene, op);
  const reused = reusableCombine(background, selected, op, id);
  return reused === undefined ? combineVectorObjects(selected, op, id) : ok(reused);
}

/** The Offset outlines result: a matching background result, else computed here. */
export function offsetOutlinesForSelection(
  scene: Scene,
  selected: ReadonlyArray<VectorSceneObject>,
  deltaMm: number,
  background: PreparedOffsetPaths | undefined,
): Result<ImportedSvg, VectorOpError> {
  const id = uniqueObjectId(scene, 'offset');
  return (
    reusableOffsetPaths(background, selected, deltaMm, id) ??
    offsetVectorObjects(selected, deltaMm, id)
  );
}
