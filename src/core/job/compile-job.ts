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
import {
  applyTransform,
  assertNever,
  type ColoredPath,
  type Scene,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../scene';
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
  // `@typescript-eslint/switch-exhaustiveness-check`. The default arm's
  // assertNever turns missing arms into compile errors when a new
  // variant lands (per ADR-014).
  switch (obj.kind) {
    case 'imported-svg':
      appendPathSegments(obj.paths, obj.transform, color, device, out);
      return;
    case 'text':
      appendPathSegments(obj.paths, obj.transform, color, device, out);
      return;
    default:
      assertNever(obj, 'SceneObject');
  }
}

// Shared materializer for any SceneObject whose paths are already
// available as ColoredPath polylines (ImportedSvg, TextObject). The
// switch above stays one-arm-per-kind for exhaustiveness, but each
// arm just delegates here — no duplicated coordinate-transform math.
function appendPathSegments(
  paths: ReadonlyArray<ColoredPath>,
  transform: Transform,
  color: string,
  device: DeviceProfile,
  out: CutSegment[],
): void {
  for (const path of paths) {
    if (path.color !== color) continue;
    for (const polyline of path.polylines) {
      const points: Vec2[] = polyline.points.map((p) =>
        toMachineCoords(applyTransform(p, transform), device),
      );
      out.push({ polyline: points, closed: polyline.closed });
    }
  }
}
