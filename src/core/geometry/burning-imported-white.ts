// White fills of an import that still burn (rolling audit v10 V2-P2-1,
// ADR-686 Amendment 2). The knock-out runs on import and Re-import only, so a
// logo imported by 1.0.29 or earlier keeps burning its white shapes, the
// second time over the black under them. A saved burn is never changed behind
// the operator's back: the open notice and Job Review count these shapes and
// offer the knock-out as one undoable step.
//
// ADR-686 Amendment 4 (rolling audit v12 X2-P1-1, X2-P3-2):
// - Duplicate, Paste, Array and nesting copies drop `svgImport`, so copies are
//   grouped without it.
// - The count is what the knock-out would actually leave unburned, so it is
//   never looser than the button: an import left as parsed (its white covers
//   every darker shape) counts nothing.
// - A white whose Fill operations all have Output off already burns nowhere
//   (U3's workaround), and a darker fill with Output off burns nothing for the
//   white to burn over; the knock-out leaves both alone.
//
// ADR-686 Amendment 5 (tools audit T1 T09-P1-1, T09R-P1-1, T09R-P1-2, T09-P2-1):
// - Copies of one import's parts made together share a placement and a source,
//   so they form one group in paint order: a logo split by a stroke keeps its
//   copied white beside its copied black.
// - Every path, original or copy, is judged by the Fill operations it burns
//   through, not by the import's mode or by all of its operations.
// - Only those Fill bindings are knocked out: a Line cut or score on the same
//   path keeps the path as it was.

import { effectiveOperationForObject } from '../effective-output';
import {
  pathUsesOperation,
  type ColoredPath,
  type ImportedSvg,
  type Layer,
  type Scene,
  type SceneObject,
} from '../scene';
import {
  isDarkFill,
  isPaperWhite,
  knockOutWhiteFills,
  type BindingSplit,
  type WhiteFillKnockoutOptions,
} from './white-fill-knockout';

/**
 * Fill parts in paint order: each import's parts together, and copies that
 * lost their import identity together when they share a source and a placement
 * (they were copied in one action, or stacked exactly; either way they paint
 * over each other in scene order).
 */
export function svgImportGroups(scene: Scene): ReadonlyArray<ReadonlyArray<ImportedSvg>> {
  const groups = new Map<string, ImportedSvg[]>();
  for (const object of scene.objects) {
    if (object.kind !== 'imported-svg') continue;
    const key = groupKey(object);
    if (object.svgImport === undefined && !object.paths.some((p) => burnsAsFill(scene, object, p)))
      continue;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [object]);
    else group.push(object);
  }
  return [...groups.values()];
}

function groupKey(object: ImportedSvg): string {
  if (object.svgImport !== undefined) return `import\u0000${object.svgImport.id}`;
  const { x, y, scaleX, scaleY, rotationDeg, mirrorX, mirrorY } = object.transform;
  return ['copy', object.source, x, y, scaleX, scaleY, rotationDeg, mirrorX, mirrorY].join(
    '\u0000',
  );
}

/**
 * Whether this path burns as a fill: it uses a Fill operation (after the
 * object's own override) with Output on. Originals and copies alike.
 */
export function burnsAsFill(scene: Scene, object: SceneObject, path: ColoredPath): boolean {
  return scene.layers.some(
    (operation) =>
      operation.output &&
      pathUsesOperation(object, path, operation) &&
      isFillBinding(operation, object),
  );
}

/** A paper white the knock-out leaves unburned: it burns as a fill. */
export function isBurningPaperWhite(scene: Scene, object: SceneObject, path: ColoredPath): boolean {
  return isPaperWhite(path) && burnsAsFill(scene, object, path);
}

const counts = new WeakMap<Scene, number>();

/** White shapes an import still burns where the import would now leave paper. */
export function countBurningImportedWhites(scene: Scene): number {
  const cached = counts.get(scene);
  if (cached !== undefined) return cached;
  let count = 0;
  for (const group of svgImportGroups(scene)) {
    // Most projects stop here, without computing any geometry.
    if (!mayBurnWhite(scene, group)) continue;
    const knockout = knockOutWhiteFills(group, savedKnockoutOptions(scene));
    if (knockout !== null && knockout.removedIds.size < group.length) count += knockout.whiteShapes;
  }
  counts.set(scene, count);
  return count;
}

/** The options the open count and Leave white unburned share. */
export function savedKnockoutOptions(scene: Scene): WhiteFillKnockoutOptions {
  return {
    isFill: () => true,
    skip: (object, path) => !burnsAsFill(scene, object, path),
    splitBindings: (object, path) => splitFillBindings(scene, object, path),
  };
}

/**
 * The path's Fill operations and the rest, when it has both: the knock-out
 * changes only the Fill bindings and keeps the path as it was for the rest.
 */
export function splitFillBindings(
  scene: Scene,
  object: SceneObject,
  path: ColoredPath,
): BindingSplit | null {
  const bound = scene.layers.filter((operation) => pathUsesOperation(object, path, operation));
  const fill = bound.filter((operation) => isFillBinding(operation, object)).map(bindingId);
  const other = bound.filter((operation) => !isFillBinding(operation, object)).map(bindingId);
  return fill.length === 0 || other.length === 0 ? null : { fill, other };
}

function isFillBinding(operation: Layer, object: SceneObject): boolean {
  return effectiveOperationForObject(operation, object).mode === 'fill';
}

function bindingId(operation: Layer): string {
  return operation.bindingOperationId ?? operation.id;
}

function mayBurnWhite(scene: Scene, group: ReadonlyArray<ImportedSvg>): boolean {
  const fills = group.flatMap((object) =>
    object.paths.flatMap((path) => (burnsAsFill(scene, object, path) ? [path] : [])),
  );
  return fills.some(isDarkFill) && fills.some(isPaperWhite);
}
