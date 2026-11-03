import type { DeviceProfile } from '../../core/devices';
import type { RasterMachineBounds } from '../../core/job/raster-bounds';
import type { Layer, RasterImage, SceneObject } from '../../core/scene';

export type PhotoEngravingPreviewInput = {
  /** The selected image, including the staged tone and operation overrides. */
  readonly image: RasterImage;
  readonly layer: Layer;
  readonly device: DeviceProfile;
  readonly sceneObjects: readonly SceneObject[];
  /** ADR-685: also draw the marks as the laser spot spreads them. */
  readonly materialView?: boolean;
};

/** ADR-685: how the material view drew each mark. */
export type PhotoMaterialSpread =
  | {
      readonly kind: 'spot';
      readonly spotMm: number;
      readonly cellMm: number;
      readonly subdivisions: number;
    }
  | { readonly kind: 'unknown-spot' };

export type PhotoEngravingPreviewResult =
  | {
      readonly kind: 'ok';
      readonly rgba: Uint8ClampedArray<ArrayBuffer>;
      /** ADR-685: marks spread by the laser spot, when the material view was asked for. */
      readonly materialRgba?: Uint8ClampedArray<ArrayBuffer>;
      readonly materialSpread?: PhotoMaterialSpread;
      /** ADR-685: the source photo's 256-level luma histogram, for Auto tones. */
      readonly sourceHistogram: Uint32Array<ArrayBuffer>;
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
  | {
      readonly kind: 'error';
      readonly message: string;
      /** The photo's histogram when only the burn grid was too big to preview. */
      readonly sourceHistogram?: Uint32Array<ArrayBuffer>;
    };

export const PHOTO_ENGRAVING_PREVIEW_MAX_EDGE = 1000;

export function photoPreviewMaxEdge(requested = PHOTO_ENGRAVING_PREVIEW_MAX_EDGE): number {
  return Number.isFinite(requested)
    ? Math.max(1, Math.min(PHOTO_ENGRAVING_PREVIEW_MAX_EDGE, Math.floor(requested)))
    : PHOTO_ENGRAVING_PREVIEW_MAX_EDGE;
}
