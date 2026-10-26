import type { Project, Scene, SceneObject } from '../../core/scene';
import { CAMERA_CAPTURE_SOURCE, withImageOutputOff } from '../../core/scene/reference-image-output';

// ADR-672: earlier builds tagged a picture kept behind its trace
// `role: 'trace-source'` and left it out of every job. The marker is dropped on
// load, so the next save writes the project without it:
// - a kept photo becomes an ordinary image that engraves on its operation, as
//   in LightBurn, where an image kept after Trace Image is engraved;
// - a kept camera capture stays out of the job the way a new one does: its
//   Image operations are left with Output off.
export function settleLegacyTraceSources(project: Project): Project {
  const legacy = project.scene.objects.filter(hasLegacyTraceSourceRole);
  if (legacy.length === 0) return project;
  let scene: Scene = { ...project.scene, objects: project.scene.objects.map(withoutLegacyRole) };
  for (const capture of legacy) {
    if (capture.kind === 'raster-image' && capture.source === CAMERA_CAPTURE_SOURCE) {
      scene = withImageOutputOff(scene, capture.id);
    }
  }
  return { ...project, scene };
}

function hasLegacyTraceSourceRole(object: SceneObject): boolean {
  return object.kind === 'raster-image' && 'role' in object;
}

function withoutLegacyRole(object: SceneObject): SceneObject {
  if (!hasLegacyTraceSourceRole(object)) return object;
  const { role: _legacyRole, ...ordinary } = object as SceneObject & { readonly role?: unknown };
  return ordinary as SceneObject;
}
