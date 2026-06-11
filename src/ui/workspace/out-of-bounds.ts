// Out-of-bed predicates shared by the canvas red-outline pass and the
// preview banner (M27, AUDIT-2026-06-10). Preflight (F-A10) is the blocking
// gate at G-code time; these drive the live UX hints.

import { transformedBBox, type Project, type SceneObject } from '../../core/scene';

export function isObjectOutOfBed(obj: SceneObject, bedW: number, bedH: number): boolean {
  const bbox = transformedBBox(obj);
  return bbox.minX < 0 || bbox.minY < 0 || bbox.maxX > bedW || bbox.maxY > bedH;
}

export function hasOutOfBoundsObjects(project: Project): boolean {
  const { bedWidth, bedHeight } = project.device;
  return project.scene.objects.some((obj) => isObjectOutOfBed(obj, bedWidth, bedHeight));
}
