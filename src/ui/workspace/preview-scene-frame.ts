// Preview frame mapping (H3, AUDIT-2026-06-10). The prepared job is in
// machine/work coordinates: compileJob maps scene points through the device
// origin transform, and applyJobOrigin may translate the whole job for
// user-origin / current-position placements. The workspace canvas, the design
// ghost, and the raster sim all draw in SCENE space — so the vector toolpath
// must be mapped back, or on the default front-left origin it renders
// mirrored about the bed midline.
//
// Mapping = undo the placement translation, then invert the origin transform
// per point. Both are isometries, so step lengths and the scrubber's
// arc-length math stay valid untouched.

import { toSceneCoords } from '../../core/devices';
import type { DeviceProfile } from '../../core/devices';
import type { Toolpath, ToolpathStep } from '../../core/job';
import type { Vec2 } from '../../core/scene';

const previewPlacementCache = new WeakMap<Toolpath, Vec2>();

/** Associate physical placement without changing the legacy Toolpath shape. */
export function registerPreviewJobOriginOffset(toolpath: Toolpath, offset: Vec2): void {
  previewPlacementCache.set(toolpath, offset);
}

/** Physical placement removed while mapping this preview into artwork space. */
export function previewJobOriginOffset(toolpath: Toolpath): Vec2 {
  return previewPlacementCache.get(toolpath) ?? { x: 0, y: 0 };
}

export function mapToolpathToScene(
  toolpath: Toolpath,
  jobOriginOffset: Vec2,
  device: DeviceProfile,
): Toolpath {
  const mapPoint = scenePointMapper(jobOriginOffset, device);
  return {
    steps: toolpath.steps.map((step) => mapStep(step, mapPoint)),
    totalLength: toolpath.totalLength,
  };
}

/**
 * Consume only a fresh buildToolpath array whose machine route is no longer
 * needed. Replacing slots releases the old geometry as mapping advances,
 * avoiding two complete multi-million-step routes. Step objects, shared
 * points, polylines and metadata are never mutated.
 */
export function mapOwnedToolpathToScene(
  toolpath: Toolpath,
  jobOriginOffset: Vec2,
  device: DeviceProfile,
): Toolpath {
  const steps = toolpath.steps as ToolpathStep[];
  const mapPoint = scenePointMapper(jobOriginOffset, device);
  steps.forEach((step, index) => {
    steps[index] = mapStep(step, mapPoint);
  });
  return { steps, totalLength: toolpath.totalLength };
}

function scenePointMapper(jobOriginOffset: Vec2, device: DeviceProfile): (p: Vec2) => Vec2 {
  return (p) => toSceneCoords({ x: p.x - jobOriginOffset.x, y: p.y - jobOriginOffset.y }, device);
}

function mapStep(step: ToolpathStep, mapPoint: (p: Vec2) => Vec2): ToolpathStep {
  if (step.kind === 'travel') {
    return { ...step, from: mapPoint(step.from), to: mapPoint(step.to) };
  }
  if (step.kind === 'plunge') {
    return { ...step, at: mapPoint(step.at) };
  }
  return { ...step, polyline: step.polyline.map(mapPoint) };
}
