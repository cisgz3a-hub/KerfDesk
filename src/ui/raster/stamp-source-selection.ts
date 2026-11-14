// Which selected objects Prepare Stamp may rasterise (ADR-350 Amendment 3).
// The stamp is a raster of the objects' stored outlines. For variable text
// those are the template glyphs ("LOT {{serial:3}}") and for a variable
// barcode the code stored when it was made, so a stamp of either would carry
// the braces or a code the canvas no longer shows (tools audit T32-P2-1).
// Like Weld, the tool leaves them out and says so; Bake Variable Text first
// fixes their value.

import type { Scene, SceneObject } from '../../core/scene';
import { geometryToolSkippedNotice, geometryToolSources } from '../state/geometry-tool-sources';
import { isConvertibleVector, type ConvertibleVector } from './bitmap-assembly';

export type StampSourceSelection = {
  /** The selected objects the stamp is made from, in scene order. */
  readonly objects: ReadonlyArray<SceneObject>;
  /** What was left out and why; empty when nothing was. */
  readonly notice: string;
  /** True when the kept objects can define a raised face. */
  readonly canPrepare: boolean;
};

export function stampSourceSelection(
  scene: Scene,
  ids: ReadonlyArray<string>,
): StampSourceSelection {
  const selected = new Set(ids);
  const objects = scene.objects.filter((object) => selected.has(object.id));
  const { kept, skipped } = geometryToolSources(scene, objects, 'variable');
  return {
    objects: kept,
    notice: geometryToolSkippedNotice(skipped),
    canPrepare: objects.length === ids.length && canPrepareStamp(kept),
  };
}

/** One raster image, or closed vector artwork only. */
export function canPrepareStamp(objects: ReadonlyArray<SceneObject>): boolean {
  return (
    objects.length > 0 &&
    ((objects.length === 1 && objects[0]?.kind === 'raster-image') ||
      objects.every(isClosedStampVector))
  );
}

export function isClosedStampVector(object: SceneObject): object is ConvertibleVector {
  if (!isConvertibleVector(object) || object.paths.length === 0) return false;
  return object.paths.every((path) => {
    const subpaths = path.curves ?? path.polylines;
    return subpaths.length > 0 && subpaths.every((part) => part.closed);
  });
}
