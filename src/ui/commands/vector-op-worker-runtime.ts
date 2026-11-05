// The vector-geometry worker's pure body (ADR-609). The worker, the no-Worker
// test fallback and the parity tests all run the same core calls the in-thread
// actions make, so a worker result equals the in-thread result.

import {
  combineVectorObjects,
  offsetVectorObjects,
  weldVectorObjects,
  type VectorOpError,
  type VectorSceneObject,
} from '../../core/geometry';
import {
  planCutShapes,
  type CutShapesCut,
  type CutShapesError,
  type CutShapesPlan,
} from '../../core/geometry/cut-shapes';
import { offsetShapes, type OffsetShapesResult } from '../../core/geometry/offset-shapes';
import { describeWeldChange, type WeldChange } from '../../core/geometry/vector-path-weld-change';
import { err, ok, type Result } from '../../core/result';
import type { ImportedSvg } from '../../core/scene';
import {
  packResultObject,
  unpackResultObject,
  type ResultObjectMessage,
} from './vector-op-result-transfer';
import type { VectorOpResponse, VectorOpTask } from './vector-op-worker-protocol';

/** A Weld preview: the union, and what it changes against the selection. */
export type WeldReview = { readonly object: ImportedSvg; readonly change: WeldChange };

type VectorOpTaskResults = {
  readonly 'offset-shapes': Result<OffsetShapesResult, VectorOpError>;
  readonly combine: Result<ImportedSvg, VectorOpError>;
  readonly weld: Result<ImportedSvg, VectorOpError>;
  readonly 'weld-review': Result<WeldReview, VectorOpError>;
  readonly 'offset-paths': Result<ImportedSvg, VectorOpError>;
  readonly 'cut-shapes': Result<CutShapesPlan, CutShapesError>;
};

export type VectorOpResultFor<T extends VectorOpTask> = VectorOpTaskResults[T['kind']];

type AnyTaskResult = VectorOpTaskResults[VectorOpTask['kind']];
type ObjectsResponse = Extract<VectorOpResponse, { readonly kind: 'objects' }>;

/** The core call each task stands for, exactly as the committing action makes it. */
export function runVectorOpTask<T extends VectorOpTask>(
  sources: ReadonlyArray<VectorSceneObject>,
  task: T,
): VectorOpResultFor<T> {
  return runTask(sources, task) as VectorOpResultFor<T>;
}

function runTask(sources: ReadonlyArray<VectorSceneObject>, task: VectorOpTask): AnyTaskResult {
  switch (task.kind) {
    case 'offset-shapes':
      return offsetShapes(sources, task.options, task.ids);
    case 'combine':
      return combineVectorObjects(sources, task.op, task.id);
    case 'weld':
      return weldVectorObjects(sources, task.id);
    case 'weld-review':
      return reviewWeld(sources, task.id, task.operandCount);
    case 'offset-paths':
      return offsetVectorObjects(sources, task.deltaMm, task.id);
    case 'cut-shapes':
      return planCutShapes(sources, new Set(task.usedIds));
  }
}

// The absorbed-shapes check runs clipper once per neighbouring shape: seconds
// at 2,000 shapes, so it belongs here rather than on the UI thread
// (performance audit S6-P2-1).
function reviewWeld(
  sources: ReadonlyArray<VectorSceneObject>,
  id: string,
  operandCount: number,
): Result<WeldReview, VectorOpError> {
  const welded = weldVectorObjects(sources.slice(0, operandCount), id);
  if (welded.kind === 'error') return welded;
  const change = describeWeldChange(sources.slice(operandCount), welded.value);
  return ok({ object: welded.value, change });
}

/** Runs a task and encodes its result for the reply, with the buffers to transfer. */
export function vectorOpResponse(
  id: number,
  sources: ReadonlyArray<VectorSceneObject>,
  task: VectorOpTask,
): { readonly response: VectorOpResponse; readonly transfer: ArrayBuffer[] } {
  const result = runTask(sources, task);
  if (result.kind === 'error') {
    return { response: { id, kind: 'error', error: result.error }, transfer: [] };
  }
  const transfer: ArrayBuffer[] = [];
  const pack = (object: ImportedSvg | null): ResultObjectMessage | null =>
    object === null ? null : packResultObject(object, transfer);
  const value = result.value;
  if ('cutterId' in value) {
    const cut = { cutterId: value.cutterId, sourceIds: value.cuts.map((entry) => entry.sourceId) };
    const objects = value.cuts.flatMap((entry) => entry.pieces.map(pack));
    return { response: { id, kind: 'objects', objects, cut }, transfer };
  }
  if ('change' in value) {
    const objects = [pack(value.object)];
    return { response: { id, kind: 'objects', objects, weldChange: value.change }, transfer };
  }
  const objects = 'kind' in value ? [pack(value)] : [pack(value.outward), pack(value.inward)];
  return { response: { id, kind: 'objects', objects }, transfer };
}

/** Decodes a non-fatal reply into the result the task's core call returned. */
export function vectorOpResult<T extends VectorOpTask>(
  task: T,
  response: Exclude<VectorOpResponse, { readonly kind: 'fatal' }>,
): VectorOpResultFor<T> {
  if (response.kind === 'error') return err(response.error) as VectorOpResultFor<T>;
  const objects = response.objects.map((object) =>
    object === null ? null : unpackResultObject(object),
  );
  if (task.kind === 'offset-shapes') {
    return ok({ outward: objects[0] ?? null, inward: objects[1] ?? null }) as VectorOpResultFor<T>;
  }
  if (task.kind === 'cut-shapes') return ok(cutPlan(response, objects)) as VectorOpResultFor<T>;
  if (task.kind === 'weld-review') {
    if (response.weldChange === undefined) {
      throw new Error('The vector worker reply has no weld change.');
    }
    const review: WeldReview = { object: required(objects[0]), change: response.weldChange };
    return ok(review) as VectorOpResultFor<T>;
  }
  return ok(required(objects[0])) as VectorOpResultFor<T>;
}

function cutPlan(
  response: ObjectsResponse,
  objects: ReadonlyArray<ImportedSvg | null>,
): CutShapesPlan {
  if (response.cut === undefined) throw new Error('The vector worker reply has no cut plan.');
  const cuts: CutShapesCut[] = response.cut.sourceIds.map((sourceId, index) => ({
    sourceId,
    pieces: [required(objects[index * 2]), required(objects[index * 2 + 1])],
  }));
  return { cutterId: response.cut.cutterId, cuts };
}

function required(object: ImportedSvg | null | undefined): ImportedSvg {
  if (object === null || object === undefined) {
    throw new Error('The vector worker reply has no result object.');
  }
  return object;
}
