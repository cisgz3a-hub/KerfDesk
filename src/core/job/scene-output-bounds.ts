import { toMachineCoords, type DeviceProfile } from '../devices';
import {
  applyTransform,
  assertNever,
  type ColoredPath,
  type Layer,
  type Scene,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../scene';
import type { JobBounds } from './job-bounds';
import { rasterBoundsInMachineCoords } from './raster-bounds';

type MutableBounds = { minX: number; minY: number; maxX: number; maxY: number };

export function computeSceneOutputBounds(scene: Scene, device: DeviceProfile): JobBounds | null {
  const bounds: MutableBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  let any = false;
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    any = extendLayerBounds(bounds, scene.objects, layer, device) || any;
  }
  return any
    ? { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY }
    : null;
}

function extendLayerBounds(
  bounds: MutableBounds,
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): boolean {
  if (layer.mode === 'image') return extendRasterLayerBounds(bounds, objects, layer, device);
  return extendVectorLayerBounds(bounds, objects, layer, device);
}

function extendVectorLayerBounds(
  bounds: MutableBounds,
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): boolean {
  let any = false;
  for (const object of objects) {
    const vector = vectorGeometry(object);
    if (vector === null) continue;
    for (const path of vector.paths) {
      if (path.color !== layer.color) continue;
      for (const polyline of path.polylines) {
        for (const point of polyline.points) {
          extendPoint(bounds, toMachineCoords(applyTransform(point, vector.transform), device));
          any = true;
        }
      }
    }
  }
  return any;
}

function extendRasterLayerBounds(
  bounds: MutableBounds,
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): boolean {
  let any = false;
  for (const object of objects) {
    if (object.kind !== 'raster-image' || object.role === 'trace-source') continue;
    if (object.color !== layer.color) continue;
    extendBounds(bounds, rasterBoundsInMachineCoords(object, device));
    any = true;
  }
  return any;
}

function vectorGeometry(
  object: SceneObject,
): { readonly paths: ReadonlyArray<ColoredPath>; readonly transform: Transform } | null {
  switch (object.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return { paths: object.paths, transform: object.transform };
    case 'raster-image':
      return null;
    default:
      return assertNever(object, 'SceneObject');
  }
}

function extendBounds(bounds: MutableBounds, next: JobBounds): void {
  if (next.minX < bounds.minX) bounds.minX = next.minX;
  if (next.minY < bounds.minY) bounds.minY = next.minY;
  if (next.maxX > bounds.maxX) bounds.maxX = next.maxX;
  if (next.maxY > bounds.maxY) bounds.maxY = next.maxY;
}

function extendPoint(bounds: MutableBounds, point: Vec2): void {
  if (point.x < bounds.minX) bounds.minX = point.x;
  if (point.y < bounds.minY) bounds.minY = point.y;
  if (point.x > bounds.maxX) bounds.maxX = point.x;
  if (point.y > bounds.maxY) bounds.maxY = point.y;
}
