import { hasClosedImageMaskGeometry } from '../../core/raster';
import type { Project, RasterImage, SceneObject } from '../../core/scene';

export type SelectedImageMaskPair = {
  readonly imageId: string;
  readonly maskId: string;
};

export function selectedImageMaskPair(
  project: Project,
  selectedIds: ReadonlyArray<string>,
): SelectedImageMaskPair | null {
  if (selectedIds.length !== 2) return null;
  const selected = selectedIds
    .map((id) => project.scene.objects.find((object) => object.id === id) ?? null)
    .filter((object): object is SceneObject => object !== null);
  const images = selected.filter((object): object is RasterImage => object.kind === 'raster-image');
  const masks = selected.filter(
    (object) => object.kind !== 'raster-image' && hasClosedImageMaskGeometry(object),
  );
  if (images.length !== 1 || masks.length !== 1) return null;
  const image = images[0];
  const mask = masks[0];
  if (image === undefined || mask === undefined) return null;
  return { imageId: image.id, maskId: mask.id };
}

/**
 * The masked image Crop, Flatten and Remove Image Mask act on: the primary
 * selection when it is one, otherwise the only masked image in the selection.
 * The primary is the first selected object in scene order, so after Apply
 * Mask (which leaves image and mask selected) it is the mask whenever the mask
 * comes first, and the three commands were refused although the selection
 * holds exactly one masked image (tools audit T1, T18-P2-1).
 */
export function selectedMaskedImage(
  project: Project,
  primary: SceneObject | null,
  selectedIds: ReadonlyArray<string>,
): RasterImage | null {
  if (primary?.kind === 'raster-image' && primary.imageMaskId !== undefined) return primary;
  const masked = selectedIds
    .map((id) => project.scene.objects.find((object) => object.id === id))
    .filter(
      (object): object is RasterImage =>
        object?.kind === 'raster-image' && object.imageMaskId !== undefined,
    );
  return masked.length === 1 ? (masked[0] ?? null) : null;
}
