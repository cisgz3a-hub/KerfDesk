// compileJob — Scene + DeviceProfile → Job.
//
// Walks every output-enabled Layer, materializes its polylines from the
// SceneObjects that match its color, applies each object's transform and the
// device's origin transform, and bundles the result with the layer's
// power / speed / passes.
//
// Pure: depends only on its arguments. No clock, no random, no I/O.
// Determinism: iteration order matches scene.layers and scene.objects (both
// arrays, indexed loops) → repeatable across runs.

import { type DeviceProfile, toMachineCoords } from '../devices';
import { applyTransform, type Scene, type SceneObject, type Vec2 } from '../scene';
import type { CutGroup, CutSegment, Job } from './job';

export function compileJob(scene: Scene, device: DeviceProfile): Job {
  const groups: CutGroup[] = [];
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    const segments = collectSegmentsForLayer(scene.objects, layer.color, device);
    if (segments.length === 0) continue;
    groups.push({
      layerId: layer.id,
      color: layer.color,
      power: clamp(layer.power, 0, 100),
      speed: Math.min(layer.speed, device.maxFeed),
      passes: Math.max(1, Math.floor(layer.passes)),
      segments,
    });
  }
  return { groups };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function collectSegmentsForLayer(
  objects: ReadonlyArray<SceneObject>,
  color: string,
  device: DeviceProfile,
): CutSegment[] {
  const out: CutSegment[] = [];
  for (const obj of objects) {
    appendSegmentsFromObject(obj, color, device, out);
  }
  return out;
}

function appendSegmentsFromObject(
  obj: SceneObject,
  color: string,
  device: DeviceProfile,
  out: CutSegment[],
): void {
  // Exhaustive over SceneObject.kind — enforced by
  // `@typescript-eslint/switch-exhaustiveness-check`. Phase D's TextObject and
  // Phase E's TracedImage each add a case arm here.
  switch (obj.kind) {
    case 'imported-svg': {
      for (const path of obj.paths) {
        if (path.color !== color) continue;
        for (const polyline of path.polylines) {
          const points: Vec2[] = polyline.points.map((p) =>
            toMachineCoords(applyTransform(p, obj.transform), device),
          );
          out.push({ polyline: points, closed: polyline.closed });
        }
      }
    }
  }
}
