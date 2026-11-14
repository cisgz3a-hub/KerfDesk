// Which operation Offset Shapes clones for its result (ADR-410 Amendment 6).
// The selection is offset as one design, so every ring goes on one operation;
// the dialog shows that operation and lets the operator pick another one of
// the selection's operations, as Union Silhouette does (ADR-350 item 2).

import type { VectorSceneObject } from '../../core/geometry';
import {
  primaryOperationForObject,
  REGISTRATION_LAYER_ID,
  sceneObjectUsesOperation,
  type Layer,
  type Scene,
} from '../../core/scene';

type ArtworkSnapshot = Readonly<Record<string, boolean>> | null;

/** The operations the offset sources use, in operation-list order. */
export function offsetResultOperations(
  scene: Scene,
  targets: ReadonlyArray<VectorSceneObject>,
): ReadonlyArray<Layer> {
  return scene.layers.filter((operation) =>
    targets.some((object) => sceneObjectUsesOperation(object, operation)),
  );
}

/**
 * Whether the operation burns. Under a jig's Outline only the artwork is off
 * only for that run, so its output is the one Artwork only will restore.
 */
export function offsetOperationOutput(operation: Layer, snapshot: ArtworkSnapshot): boolean {
  return snapshot?.[operation.id] ?? operation.output;
}

/**
 * The chosen operation when it is one of the sources' operations; otherwise
 * the primary selection's operation when it burns, else the first one that
 * burns, else the primary selection's. Jig outlines are never the default.
 */
export function offsetResultOperation(
  scene: Scene,
  targets: ReadonlyArray<VectorSceneObject>,
  options: {
    readonly primaryId: string | null;
    readonly chosenId?: string;
    readonly snapshot: ArtworkSnapshot;
  },
): Layer | null {
  const operations = offsetResultOperations(scene, targets);
  const chosen = operations.find((operation) => operation.id === options.chosenId);
  if (chosen !== undefined) return chosen;
  const primary = targets.find((object) => object.id === options.primaryId) ?? targets[0];
  const primaryOperation =
    primary === undefined ? null : primaryOperationForObject(primary, scene.layers);
  const burns = (operation: Layer): boolean =>
    operation.id !== REGISTRATION_LAYER_ID && offsetOperationOutput(operation, options.snapshot);
  if (primaryOperation !== null && burns(primaryOperation)) return primaryOperation;
  return operations.find(burns) ?? primaryOperation ?? operations[0] ?? null;
}

/** The warning for a result operation that will not burn; empty when it burns. */
export function offsetOperationOffNotice(
  operation: Layer | null,
  snapshot: ArtworkSnapshot,
): string {
  if (operation === null || offsetOperationOutput(operation, snapshot)) return '';
  return `The offset goes on a copy of “${operation.name}”, whose output is off, so it will not burn. Choose another operation or turn the copy's output on.`;
}
