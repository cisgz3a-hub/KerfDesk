// White fills of an import that still burn (rolling audit v10 V2-P2-1,
// ADR-686 Amendment 2). The knock-out runs on import and Re-import only, so a
// logo imported by 1.0.29 or earlier keeps burning its white shapes, the
// second time over the black under them. A saved burn is never changed behind
// the operator's back: the open notice and Job Review count these shapes and
// offer the knock-out as one undoable step.
//
// ADR-686 Amendment 4 (rolling audit v12 X2-P1-1, X2-P3-2):
// - Duplicate, Paste, Array and nesting copies drop `svgImport`, so each copy
//   of an imported part is its own group, and its Fill mode is read from its
//   operations. One part's paths are one paint order.
// - The count is what the knock-out would actually leave unburned, so it is
//   never looser than the button: an import left as parsed (its white covers
//   every darker shape) counts nothing.
// - A white whose operations all have Output off already burns nowhere (U3's
//   workaround), and a darker fill with Output off burns nothing for the white
//   to burn over; the knock-out leaves both alone.

import {
  pathUsesOperation,
  type ColoredPath,
  type ImportedSvg,
  type Scene,
  type SceneObject,
} from '../scene';
import { isDarkFill, isPaperWhite, knockOutWhiteFills } from './white-fill-knockout';

/** Fill parts in paint order: each import's parts together, each copy alone. */
export function svgImportGroups(scene: Scene): ReadonlyArray<ReadonlyArray<ImportedSvg>> {
  const groups = new Map<string, ImportedSvg[]>();
  const copies: ImportedSvg[][] = [];
  for (const object of scene.objects) {
    if (object.kind !== 'imported-svg') continue;
    const id = object.svgImport?.id;
    if (id === undefined) {
      if (isSavedFillPart(scene, object)) copies.push([object]);
      continue;
    }
    const group = groups.get(id);
    if (group === undefined) groups.set(id, [object]);
    else group.push(object);
  }
  return [...groups.values(), ...copies];
}

/**
 * Whether the knock-out reads this part as Fill artwork: its import's mode, or,
 * for a copy that lost its import identity, every operation its paths use is a
 * Fill operation (a copy of a Line part stays a cut).
 */
export function isSavedFillPart(scene: Scene, object: ImportedSvg): boolean {
  if (object.svgImport !== undefined) return object.svgImport.mode === 'fill';
  if (object.operationOverride?.mode !== undefined) return object.operationOverride.mode === 'fill';
  const modes = object.paths.flatMap((path) =>
    scene.layers
      .filter((operation) => pathUsesOperation(object, path, operation))
      .map((operation) => operation.mode),
  );
  return modes.length > 0 && modes.every((mode) => mode === 'fill');
}

/** A paper white that burns nowhere: every operation it uses has Output off. */
export function isWhiteOutputOff(scene: Scene, object: SceneObject, path: ColoredPath): boolean {
  return isPaperWhite(path) && !burns(scene, object, path);
}

/** Paths the saved knock-out leaves alone: white or darker fill with Output off. */
export function isSavedKnockoutSkip(scene: Scene, object: SceneObject, path: ColoredPath): boolean {
  return (isPaperWhite(path) || isDarkFill(path)) && !burns(scene, object, path);
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
export function savedKnockoutOptions(scene: Scene) {
  return {
    skip: (object: ImportedSvg, path: ColoredPath) => isSavedKnockoutSkip(scene, object, path),
    isFill: (object: ImportedSvg) => isSavedFillPart(scene, object),
  };
}

function mayBurnWhite(scene: Scene, group: ReadonlyArray<ImportedSvg>): boolean {
  const fills = group.flatMap((object) =>
    isSavedFillPart(scene, object) ? object.paths.map((path) => ({ object, path })) : [],
  );
  return (
    fills.some(({ object, path }) => isDarkFill(path) && burns(scene, object, path)) &&
    fills.some(({ object, path }) => isPaperWhite(path) && burns(scene, object, path))
  );
}

function burns(scene: Scene, object: SceneObject, path: ColoredPath): boolean {
  return scene.layers.some(
    (operation) => operation.output && pathUsesOperation(object, path, operation),
  );
}
