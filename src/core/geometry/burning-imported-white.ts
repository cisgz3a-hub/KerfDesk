// White fills of an import that still burn (rolling audit v10 V2-P2-1,
// ADR-686 Amendment 2). The knock-out runs on import and Re-import only, so a
// logo imported by 1.0.29 or earlier keeps burning its white shapes, the
// second time over the black under them. A saved burn is never changed behind
// the operator's back: the open notice and Job Review count these shapes and
// offer the knock-out as one undoable step.
//
// The count reads the same rule the import does (paper white beside a darker
// fill in one import) without computing any geometry, so Job Review can ask it
// on every rebuild. A white whose operations all have Output off already does
// not burn, so it is left alone: that operator found the old workaround.

import {
  pathUsesOperation,
  type ColoredPath,
  type ImportedSvg,
  type Scene,
  type SceneObject,
} from '../scene';
import { isDarkFill, isPaperWhite } from './white-fill-knockout';

/** Each SVG import's parts in paint order, keyed by the import they came from. */
export function svgImportGroups(scene: Scene): ReadonlyArray<ReadonlyArray<ImportedSvg>> {
  const groups = new Map<string, ImportedSvg[]>();
  for (const object of scene.objects) {
    const id = object.kind === 'imported-svg' ? object.svgImport?.id : undefined;
    if (id === undefined || object.kind !== 'imported-svg') continue;
    const group = groups.get(id);
    if (group === undefined) groups.set(id, [object]);
    else group.push(object);
  }
  return [...groups.values()];
}

/** A paper white that burns nowhere: every operation it uses has Output off. */
export function isWhiteOutputOff(scene: Scene, object: SceneObject, path: ColoredPath): boolean {
  return (
    isPaperWhite(path) &&
    !scene.layers.some(
      (operation) => operation.output && pathUsesOperation(object, path, operation),
    )
  );
}

/** White shapes an import still burns where the import would now leave paper. */
export function countBurningImportedWhites(scene: Scene): number {
  let count = 0;
  for (const group of svgImportGroups(scene)) {
    const fills = group.flatMap((object) =>
      object.svgImport?.mode === 'fill' ? object.paths.map((path) => ({ object, path })) : [],
    );
    if (!fills.some(({ path }) => isDarkFill(path))) continue;
    count += fills.filter(
      ({ object, path }) => isPaperWhite(path) && !isWhiteOutputOff(scene, object, path),
    ).length;
  }
  return count;
}
