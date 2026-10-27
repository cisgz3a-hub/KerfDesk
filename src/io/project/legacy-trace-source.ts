import type { Project, Scene, SceneObject } from '../../core/scene';
import { CAMERA_CAPTURE_SOURCE, withImageOutputOff } from '../../core/scene/reference-image-output';

export type SettledTraceSources = {
  readonly project: Project;
  /** Kept photos (not camera captures) the load set to Output off. */
  readonly keptPhotosOff: number;
};

// ADR-673: earlier builds tagged a picture kept behind its trace
// `role: 'trace-source'` and left it out of every job. The marker is dropped on
// load, so the next save writes the project without it, and the picture keeps
// the job it had (ADR-673 Amendment 1): its Image operations are left with
// Output off, or it moves to an output-off copy of one other artwork shares, as
// a new camera capture does. A kept photo is counted so every reader can say
// it is off and how to engrave it; a camera capture never engraved anyway.
export function settleLegacyTraceSources(project: Project): SettledTraceSources {
  const legacy = project.scene.objects.filter(hasLegacyTraceSourceRole);
  if (legacy.length === 0) return { project, keptPhotosOff: 0 };
  let scene: Scene = { ...project.scene, objects: project.scene.objects.map(withoutLegacyRole) };
  for (const picture of legacy) scene = withImageOutputOff(scene, picture.id);
  const keptPhotosOff = legacy.filter(
    (picture) => picture.kind === 'raster-image' && picture.source !== CAMERA_CAPTURE_SOURCE,
  ).length;
  return { project: { ...project, scene }, keptPhotosOff };
}

function hasLegacyTraceSourceRole(object: SceneObject): boolean {
  return object.kind === 'raster-image' && 'role' in object;
}

function withoutLegacyRole(object: SceneObject): SceneObject {
  if (!hasLegacyTraceSourceRole(object)) return object;
  const { role: _legacyRole, ...ordinary } = object as SceneObject & { readonly role?: unknown };
  return ordinary as SceneObject;
}
