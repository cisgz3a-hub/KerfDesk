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
  const dpi = input.dpi ?? DEFAULT_DPI;
  const widthMm = (input.naturalWidth / dpi) * MM_PER_INCH;
  const heightMm = (input.naturalHeight / dpi) * MM_PER_INCH;
  return {
    bounds: { minX: 0, minY: 0, maxX: widthMm, maxY: heightMm },
    pixelWidth: input.sampledWidth,
    pixelHeight: input.sampledHeight,
  };
}
