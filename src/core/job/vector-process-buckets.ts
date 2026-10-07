import type { Layer, SceneObject, ColoredPath } from '../scene';
import { layerOperationSettingsEqual, sceneObjectUsesOperation } from '../scene';
import {
  effectiveOperationForObject,
  operationOverrideForObject,
} from '../scene/effective-operation';
import { effectiveObjectPowerPercent } from './object-power-scale';
import { sharedObjectPowerScalePercent } from './compile-job-object-policy';

export type VectorArtwork = Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>;
export type VectorProcessBucket = {
  readonly layer: Layer;
  readonly objects: VectorArtwork[];
  readonly powerSource: VectorArtwork;
  readonly power: number;
};

// Preserve historical process traversal: settings buckets first, then one group per object
// when a settings bucket has heterogeneous source power scales (A80/B40/C80 stays A/B/C).
export function vectorProcessBuckets(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
): VectorProcessBucket[] {
  const settingsBuckets: Array<{ layer: Layer; objects: VectorArtwork[] }> = [];
  for (const object of objects) {
    if (!('paths' in object) || !sceneObjectUsesOperation(object, layer)) continue;
    const effective = effectiveOperationForObject(layer, object);
    if (effective.mode === 'image') continue;
    const bucket = settingsBuckets.find((candidate) =>
      layerOperationSettingsEqual(candidate.layer, effective),
    );
    if (bucket === undefined) settingsBuckets.push({ layer: effective, objects: [object] });
    else bucket.objects.push(object);
  }
  return settingsBuckets.flatMap((bucket) => {
    if (sharedObjectPowerScalePercent(bucket.objects) === undefined)
      return bucket.objects.map((object) => ({
        layer: bucket.layer,
        objects: [object],
        powerSource: object,
        power: effectiveObjectPowerPercent(bucket.layer, object),
      }));
    const powerSource =
      bucket.objects.find((object) => operationOverrideForObject(layer, object) !== undefined) ??
      bucket.objects[0];
    return powerSource === undefined
      ? []
      : [{ ...bucket, powerSource, power: effectiveObjectPowerPercent(bucket.layer, powerSource) }];
  });
}
