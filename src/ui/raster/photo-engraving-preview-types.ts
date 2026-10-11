import type { DeviceProfile } from '../../core/devices';
import type { RasterMachineBounds } from '../../core/job/raster-bounds';
import type { Layer, RasterImage, SceneObject } from '../../core/scene';

export type PhotoEngravingPreviewInput = {
  /** The selected image, including the staged tone and operation overrides. */
  readonly image: RasterImage;
  readonly layer: Layer;
  readonly device: DeviceProfile;
  readonly sceneObjects: readonly SceneObject[];
};

export type PhotoEngravingPreviewResult =
  | {
      readonly kind: 'ok';
      readonly rgba: Uint8ClampedArray<ArrayBuffer>;
      readonly width: number;
      readonly height: number;
      readonly sourceWidth: number;
      readonly sourceHeight: number;
      readonly displayDecimated: boolean;
      /** Bounds in the first compiled scan's coordinate frame. */
      readonly bounds: RasterMachineBounds;
      readonly scanAngleDeg: number;
      readonly scanCount: number;
      readonly scanPasses: number;
      /** Relative marks, not calibrated material colour, power or motion. */
      readonly normalization: 'relative-marks';
    }
  | { readonly kind: 'error'; readonly message: string };

export const PHOTO_ENGRAVING_PREVIEW_MAX_EDGE = 1000;

export function photoPreviewMaxEdge(requested = PHOTO_ENGRAVING_PREVIEW_MAX_EDGE): number {
  return Number.isFinite(requested)
    ? Math.max(1, Math.min(PHOTO_ENGRAVING_PREVIEW_MAX_EDGE, Math.floor(requested)))
    : PHOTO_ENGRAVING_PREVIEW_MAX_EDGE;
}
