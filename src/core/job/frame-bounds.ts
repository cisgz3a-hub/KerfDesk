// computeFrameBounds - cheap machine-space bounds for the Frame action.
//
// Frame only needs the output-enabled burn area. It must not run compileJob:
// fill hatching and raster dither/resampling are Start/Save work and can be
// expensive on large traces or images. This mirrors compileJob's layer/object
// inclusion rules while collecting only transformed AABBs.

import { toMachineCoords, type DeviceProfile } from '../devices';
import {
  applyTransform,
  assertNever,
  outputOperationLayers,
  type ColoredPath,
  type Layer,
  type Scene,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../scene';
import type { JobOriginPlacement } from './job-origin';
import type { JobBounds } from './job-bounds';
import { offsetJobBounds } from './job-origin';
import { rasterBoundsInMachineCoords } from './raster-bounds';

export type ComputeFrameBoundsOptions = {
  readonly jobOrigin?: JobOriginPlacement;
};

type MutableBounds = { minX: number; minY: number; maxX: number; maxY: number };

export function computeFrameBounds(
  scene: Scene,
  device: DeviceProfile,
  options: ComputeFrameBoundsOptions = {},
): JobBounds | null {
  const output = outputLayerModesByColor(scene.layers);
  if (output.size === 0) return null;

  const bounds: MutableBounds = emptyBounds();
  let any = false;
  for (const object of scene.objects) {
    if (extendBoundsForObject(bounds, object, output, device)) any = true;
  }
  if (!any) return null;

  const unplaced: JobBounds = {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  };
  return options.jobOrigin === undefined
    ? unplaced
    : offsetJobBounds(unplaced, jobOriginOffsetForBounds(unplaced, options.jobOrigin));
}

function outputLayerModesByColor(
  layers: ReadonlyArray<Layer>,
): ReadonlyMap<string, ReadonlySet<Layer['mode']>> {
  const modesByColor = new Map<string, Set<Layer['mode']>>();
  for (const layer of layers) {
    for (const operationLayer of outputOperationLayers(layer)) {
      let modes = modesByColor.get(operationLayer.color);
      if (modes === undefined) {
        modes = new Set<Layer['mode']>();
        modesByColor.set(operationLayer.color, modes);
      }
      modes.add(operationLayer.mode);
    }
  }
  return modesByColor;
}

function extendBoundsForObject(
  bounds: MutableBounds,
  object: SceneObject,
  output: ReadonlyMap<string, ReadonlySet<Layer['mode']>>,
  device: DeviceProfile,
): boolean {
  switch (object.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return extendBoundsForVectorPaths(bounds, object.paths, object.transform, output, device);
    case 'raster-image': {
      if (object.role === 'trace-source') return false;
      if (!output.get(object.color)?.has('image')) return false;
      return extendBounds(bounds, rasterBoundsInMachineCoords(object, device));
    }
    default:
      return assertNever(object, 'SceneObject');
  }
}

function extendBoundsForVectorPaths(
  bounds: MutableBounds,
  paths: ReadonlyArray<ColoredPath>,
  transform: Transform,
  output: ReadonlyMap<string, ReadonlySet<Layer['mode']>>,
  device: DeviceProfile,
): boolean {
  let any = false;
  for (const path of paths) {
    const modes = output.get(path.color);
    if (modes === undefined || (!modes.has('line') && !modes.has('fill'))) continue;
    for (const polyline of path.polylines) {
      for (const point of polyline.points) {
        extendPoint(bounds, toMachineCoords(applyTransform(point, transform), device));
        any = true;
      }
    }
  }
  return any;
}

function emptyBounds(): MutableBounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

function extendBounds(bounds: MutableBounds, next: JobBounds): boolean {
  extendPoint(bounds, { x: next.minX, y: next.minY });
  extendPoint(bounds, { x: next.maxX, y: next.maxY });
  return true;
}

function extendPoint(bounds: MutableBounds, point: Vec2): void {
  if (point.x < bounds.minX) bounds.minX = point.x;
  if (point.x > bounds.maxX) bounds.maxX = point.x;
  if (point.y < bounds.minY) bounds.minY = point.y;
  if (point.y > bounds.maxY) bounds.maxY = point.y;
}

function jobOriginOffsetForBounds(bounds: JobBounds, placement: JobOriginPlacement): Vec2 {
  const target = targetPoint(placement);
  if (target === null) return { x: 0, y: 0 };
  const anchor = anchorPoint(bounds, placement.anchor);
  return { x: target.x - anchor.x, y: target.y - anchor.y };
}

function targetPoint(placement: JobOriginPlacement): Vec2 | null {
  switch (placement.startFrom) {
    case 'absolute':
      return null;
    case 'user-origin':
    case 'verified-origin':
      return { x: 0, y: 0 };
    case 'current-position':
      return placement.currentPosition;
    default:
      return assertNever(placement, 'JobOriginPlacement');
  }
}

function anchorPoint(bounds: JobBounds, anchor: JobOriginPlacement['anchor']): Vec2 {
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  switch (anchor) {
    case 'front-left':
      return { x: bounds.minX, y: bounds.minY };
    case 'front-center':
      return { x: midX, y: bounds.minY };
    case 'front-right':
      return { x: bounds.maxX, y: bounds.minY };
    case 'center-left':
      return { x: bounds.minX, y: midY };
    case 'center':
      return { x: midX, y: midY };
    case 'center-right':
      return { x: bounds.maxX, y: midY };
    case 'back-left':
      return { x: bounds.minX, y: bounds.maxY };
    case 'back-center':
      return { x: midX, y: bounds.maxY };
    case 'back-right':
      return { x: bounds.maxX, y: bounds.maxY };
    default:
      return assertNever(anchor, 'JobOriginAnchor');
  }
}
