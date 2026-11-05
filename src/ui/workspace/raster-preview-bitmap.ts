// The burned-image bitmap the canvas Preview draws for one raster (F.2.c,
// ADR-028): the job's own raster compile, reduced for display. Shared by the
// raster preview worker and the in-window fallback, so both draw the same
// pixels (perf audit S4-P3-1).

import type { DeviceProfile } from '../../core/devices';
import { compileRasterGroupsForLayer } from '../../core/job/compile-job-raster';
import type { Layer, RasterImage, SceneObject } from '../../core/scene';
import { compiledRasterPreview } from './compiled-raster-preview';

export type RasterPreviewBitmapInput = {
  readonly image: RasterImage;
  readonly layer: Layer;
  readonly device: DeviceProfile;
  /** The scene objects the compile may consult: the raster's image mask. */
  readonly sceneObjects: ReadonlyArray<SceneObject>;
};

export type RasterPreviewBitmap = {
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
};

export function rasterPreviewBitmap(input: RasterPreviewBitmapInput): RasterPreviewBitmap | null {
  const compilation = compileRasterGroupsForLayer([input.image], input.layer, input.device, {
    sceneObjects: input.sceneObjects,
  });
  const group = compilation.groups[0];
  if (group === undefined) return null;
  const { rgba, width, height } = compiledRasterPreview(group, input.device);
  return { rgba, width, height };
}
