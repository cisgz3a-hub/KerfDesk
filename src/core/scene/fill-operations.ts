// The Fill operations that burn a filled path (ADR-683 Amendments 1 and 2).
//
// This is what the compiler does, from the helpers it uses itself, so the
// canvas, the hit test and the artwork exports cannot drift from it:
// `compileJob` walks each Output-on operation with `outputOperationLayers`,
// takes an object's effective mode there, and hatches every path that
// `pathUsesOperation` binds to it, pooled even-odd with that operation's other
// objects in the same compile run. Any such operation inks the path, whichever
// binding comes first; a Line binding keeps its stroke beside the fill.
//
// A path with no output at all still shows, under its first operation, as what
// it would burn; an Output-off operation never counts beside an Output-on one.

import { effectiveOperationForObject } from './effective-operation';
import { outputOperationLayers, type Layer } from './layer';
import { pathUsesOperation } from './operation-binding';
import { separatelyCompiledJigInstances } from './registration-jig-artwork';
import type { Scene } from './scene';
import type { ColoredPath, SceneObject } from './scene-object';
import { resolveVisibleOperationForPath, visibleOperationsForPath } from './visibility';

export type PathFillOperation = {
  readonly operation: Layer;
  /** Whether the operation burns; false only when nothing bound to the path does. */
  readonly output: boolean;
};

const NONE: ReadonlyArray<PathFillOperation> = [];

/** The visible Fill operations a path burns under, or the one it shows under. */
export function pathFillOperations(
  object: SceneObject,
  path: ColoredPath,
  operationLookup: ReadonlyMap<string, Layer>,
): ReadonlyArray<PathFillOperation> {
  return fillOperationsAmong(object, boundVisibleOperations(object, path, operationLookup));
}

/** The rule itself, over operations a path is known to use, first the one that would style it. */
export function fillOperationsAmong(
  object: SceneObject,
  operations: ReadonlyArray<Layer>,
): ReadonlyArray<PathFillOperation> {
  const burning = operations.filter((operation) =>
    outputOperationLayers(operation).some(
      (layer) => effectiveOperationForObject(layer, object).mode === 'fill',
    ),
  );
  if (burning.length > 0) return burning.map((operation) => ({ operation, output: true }));
  // Output-on and not Fill: the job only cuts or engraves this path.
  if (operations.some((operation) => operation.output)) return NONE;
  const first = operations[0];
  return first !== undefined && effectiveOperationForObject(first, object).mode === 'fill'
    ? [{ operation: first, output: false }]
    : NONE;
}

/** The operation whose settings style a path: the first that outputs, else the first visible. */
export function pathStylingOperation(
  object: SceneObject,
  path: ColoredPath,
  operationLookup: ReadonlyMap<string, Layer>,
): Layer | undefined {
  return (
    boundVisibleOperations(object, path, operationLookup).find((operation) => operation.output) ??
    resolveVisibleOperationForPath(object, path, operationLookup).operation
  );
}

function boundVisibleOperations(
  object: SceneObject,
  path: ColoredPath,
  operationLookup: ReadonlyMap<string, Layer>,
): ReadonlyArray<Layer> {
  const candidates =
    (path.operationIds ?? object.operationIds) === undefined
      ? // An unbound path burns under every operation of its colour.
        [...new Set(operationLookup.values())].filter((operation) => operation.visible)
      : visibleOperationsForPath(object, path, operationLookup);
  return candidates.filter((operation) => pathUsesOperation(object, path, operation));
}

/** The compile run an object burns in: pools never cross one. */
export type FillPoolRuns = (object: SceneObject) => string;

export const ONE_FILL_POOL_RUN: FillPoolRuns = () => '';

const runsByObjects = new WeakMap<
  ReadonlyArray<SceneObject>,
  { readonly layers: ReadonlyArray<Layer>; readonly runs: FillPoolRuns }
>();

/** Each jig instance compiles alone when the job schedules them apart; the rest share a run. */
export function fillPoolRuns(scene: Scene): FillPoolRuns {
  const cached = runsByObjects.get(scene.objects);
  if (cached?.layers === scene.layers) return cached.runs;
  const instances = separatelyCompiledJigInstances(scene);
  let runs = ONE_FILL_POOL_RUN;
  if (instances.length > 0) {
    const boxByObject = new Map<string, string>();
    for (const { boxId, objects } of instances) {
      for (const object of objects) boxByObject.set(object.id, boxId);
    }
    runs = (object) => boxByObject.get(object.id) ?? '';
  }
  runsByObjects.set(scene.objects, { layers: scene.layers, runs });
  return runs;
}

/** One Fill pool: an operation's objects in one compile run, with one output switch. */
export function fillPoolKey(fill: PathFillOperation, run: string): string {
  return `${run}\n${fill.operation.id}\n${fill.output ? 1 : 0}`;
}
