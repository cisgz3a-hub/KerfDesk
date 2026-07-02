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

export function mapToolpathToScene(
  toolpath: Toolpath,
  jobOriginOffset: Vec2,
  device: DeviceProfile,
): Toolpath {
  const mapPoint = (p: Vec2): Vec2 =>
    toSceneCoords({ x: p.x - jobOriginOffset.x, y: p.y - jobOriginOffset.y }, device);
  return {
    steps: toolpath.steps.map((step) => mapStep(step, mapPoint)),
    totalLength: toolpath.totalLength,
  };
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
