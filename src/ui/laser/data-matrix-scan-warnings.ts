// Data Matrix codes output builds at 144 x 144 (ADR-386 Amendment 2). Insert
// and Edit stop at 132 x 132, the largest size whose reader layout is pinned,
// but a variable value can need 144 x 144 when output evaluates it, and a code
// saved by an earlier build can already be that size. Such a code can be
// built, so output makes it and Job Review names it: readers may not scan it.
// A warning, never a refusal (PROJECT.md non-negotiable 21).

import { dataMatrixNeedsUnverifiedSize, isBarcodeObject } from '../../core/barcode';
import {
  outputOperationLayers,
  sceneObjectUsesOperation,
  type Project,
  type SceneObject,
} from '../../core/scene';

// One grouped warning, so an array of such codes does not drown the review.
const MAX_NAMED_BARCODES = 4;

const ADVICE =
  '144 × 144 Data Matrix codes may not scan in common readers, so test-scan one before a run.';

/** Reads the prepared project, where each variable barcode holds this output's value. */
export function detectDataMatrixScanWarnings(project: Project): ReadonlyArray<string> {
  const operations = project.scene.layers.flatMap(outputOperationLayers);
  const ids = project.scene.objects
    .filter(
      (object) =>
        needsUnverifiedSize(object) &&
        operations.some((operation) => sceneObjectUsesOperation(object, operation)),
    )
    .map((object) => object.id);
  const [first] = ids;
  if (first === undefined) return [];
  if (ids.length === 1) return [`Barcode ${first} is a 144 × 144 Data Matrix. ${ADVICE}`];
  return [`Barcodes ${idList(ids)} are 144 × 144 Data Matrix codes. ${ADVICE}`];
}

// A barcode still holding its template was not evaluated for this output: it
// engraves its stored code, whose value the template does not give.
function needsUnverifiedSize(object: SceneObject): boolean {
  return (
    isBarcodeObject(object) &&
    object.spec.symbology === 'data-matrix' &&
    object.spec.variableTemplate === undefined &&
    dataMatrixNeedsUnverifiedSize(object.spec.data)
  );
}

function idList(ids: ReadonlyArray<string>): string {
  const named = ids.slice(0, MAX_NAMED_BARCODES);
  const extra = ids.length - named.length;
  if (extra > 0) return `${named.join(', ')} and ${extra} more`;
  return `${named.slice(0, -1).join(', ')} and ${named.at(-1) ?? ''}`;
}
