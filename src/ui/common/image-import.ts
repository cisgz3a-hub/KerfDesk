import type { Bounds } from '../../core/scene';

const MM_PER_INCH = 25.4;
// ADR-048: a metadata-less bitmap imports at LightBurn's reference 254 DPI
// (0.1 mm/pixel) so a 1000 px image lands at 100 mm, matching what a LightBurn
// switcher expects. This is the BITMAP default only; SVG px stay 96 DPI per
// ADR-046 (that is LightBurn's separate SVG-import convention).
const DEFAULT_DPI = 254;

export type RasterImportGeometryInput = {
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly sampledWidth: number;
  readonly sampledHeight: number;
  readonly dpi?: number;
};

export type RasterImportGeometry = {
  readonly bounds: Bounds;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
};

// The import success toast must report the source image's real pixel size, not
// the <=2048 px decode grid loadImageAsRawData samples for luma — telling the
// operator a 6000x4000 photo is "2048x1365 px" misstates the file. When the
// source exceeded the cap, append the working resolution so the cap is visible.
export function describeImportedImageSize(
  natural: { readonly width: number; readonly height: number },
  sampled: { readonly width: number; readonly height: number },
): string {
  const naturalLabel = `${natural.width}x${natural.height} px`;
  if (sampled.width === natural.width && sampled.height === natural.height) return naturalLabel;
  return `${naturalLabel}, processed at ${sampled.width}x${sampled.height}`;
}

export function rasterImportGeometry(input: RasterImportGeometryInput): RasterImportGeometry {
  // Defense in depth: a non-positive or non-finite dpi (poison metadata, a 0
  // that slipped past the density parser) would make widthMm Infinity/NaN and
  // poison every downstream save. Fall back to the default rather than emit it.
  const dpi =
    input.dpi !== undefined && Number.isFinite(input.dpi) && input.dpi > 0
      ? input.dpi
      : DEFAULT_DPI;
  const widthMm = (input.naturalWidth / dpi) * MM_PER_INCH;
  const heightMm = (input.naturalHeight / dpi) * MM_PER_INCH;
  return {
    bounds: { minX: 0, minY: 0, maxX: widthMm, maxY: heightMm },
    pixelWidth: input.sampledWidth,
    pixelHeight: input.sampledHeight,
  };
}
