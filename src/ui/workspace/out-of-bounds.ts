// Out-of-bed predicates shared by the canvas red-outline pass and the
// preview banner (M27, AUDIT-2026-06-10). Preflight (F-A10) is the blocking
// gate at G-code time; these drive the live UX hints.

import { transformedBBox, type Project, type SceneObject } from '../../core/scene';
import { BED_FIT_TOLERANCE_MM } from '../../core/scene/fit-to-bed';

// Centering bed-sized art can leave an edge a few ulps outside the bed; the
// same tolerance the importer uses keeps that float noise from reading as
// off-bed.
export function isObjectOutOfBed(obj: SceneObject, bedW: number, bedH: number): boolean {
  const bbox = transformedBBox(obj);
  const tol = BED_FIT_TOLERANCE_MM;
  return bbox.minX < -tol || bbox.minY < -tol || bbox.maxX > bedW + tol || bbox.maxY > bedH + tol;
}

export function hasOutOfBoundsObjects(project: Project): boolean {
  const { bedWidth, bedHeight } = project.device;
  return project.scene.objects.some((obj) => isObjectOutOfBed(obj, bedWidth, bedHeight));
}
