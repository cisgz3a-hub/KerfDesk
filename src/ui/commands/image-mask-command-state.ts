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
