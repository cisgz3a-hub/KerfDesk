// The operation runs output actually burns for one piece of artwork, shared by
// Advanced artwork settings and the hover readout (ADR-348 Amendment 1) so both
// name the numbers compile uses. Pure: no DOM, no store.

import { effectiveOperationForObject } from '../../core/effective-output';
import { imageDitherAlgorithm } from '../../core/raster/image-processing';
import {
  outputOperationLayers,
  sceneObjectUsesOperation,
  type Layer,
  type SceneObject,
} from '../../core/scene';

export type ArtworkOutputRun = {
  /** The operation row, or the sub-operation as output materializes it. */
  readonly run: Layer;
  /** The run with the artwork's own override applied. */
  readonly effective: Layer;
  /** The colour of the operation row the run belongs to. */
  readonly color: string;
};

/**
 * Each enabled operation and sub-operation the piece uses, minus the ones
 * compile skips for it: vector artwork on an Image run, a bitmap on a Line or
 * Fill run, a trace's source bitmap and a CNC relief.
 */
export function artworkOutputRuns(
  object: SceneObject,
  layers: ReadonlyArray<Layer>,
): ReadonlyArray<ArtworkOutputRun> {
  return layers
    .filter((layer) => sceneObjectUsesOperation(object, layer))
    .flatMap((layer) =>
      outputOperationLayers(layer).flatMap((run) => {
        const effective = effectiveOperationForObject(run, object);
        return runBurnsArtwork(object, run, effective)
          ? [{ run, effective, color: layer.color }]
          : [];
      }),
    );
}

/**
 * Only Grayscale (and "Use original pixels", which burns as Grayscale) shades
 * between Min Power and the peak; every dither burns full power or nothing.
 */
export function runUsesMinPower(effective: Layer): boolean {
  return effective.mode === 'image' && imageDitherAlgorithm(effective) === 'grayscale';
}

// Mirrors compile: vectors only on a run that is not Image (compile-job and
// vectorProcessBuckets), bitmaps only on an effective Image run
// (compileRasterGroupsForLayer).
function runBurnsArtwork(object: SceneObject, run: Layer, effective: Layer): boolean {
  if (object.kind === 'relief') return false;
  if (object.kind === 'raster-image') return effective.mode === 'image';
  return run.mode !== 'image' && effective.mode !== 'image';
}
