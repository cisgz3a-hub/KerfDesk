import type { Bounds } from '../../core/scene';

const MM_PER_INCH = 25.4;
const DEFAULT_DPI = 96;

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
