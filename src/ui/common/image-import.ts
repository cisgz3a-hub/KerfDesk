import type { Bounds } from '../../core/scene';
import type { ImageDensity } from './image-density';

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
  readonly density?: ImageDensity | null;
};

export type RasterImportGeometry = {
  readonly bounds: Bounds;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly density: ImageDensity;
  readonly densitySource: 'embedded' | 'default';
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
  const xDpi = validDpi(input.density?.xDpi) ?? DEFAULT_DPI;
  const yDpi = validDpi(input.density?.yDpi) ?? DEFAULT_DPI;
  const embedded = validDpi(input.density?.xDpi) !== null && validDpi(input.density?.yDpi) !== null;
  const widthMm = (input.naturalWidth / xDpi) * MM_PER_INCH;
  const heightMm = (input.naturalHeight / yDpi) * MM_PER_INCH;
  return {
    bounds: { minX: 0, minY: 0, maxX: widthMm, maxY: heightMm },
    pixelWidth: input.sampledWidth,
    pixelHeight: input.sampledHeight,
    density: { xDpi, yDpi },
    densitySource: embedded ? 'embedded' : 'default',
  };
}

export function describeImportDensity(geometry: RasterImportGeometry): string {
  const { xDpi, yDpi } = geometry.density;
  const axes = xDpi === yDpi ? `${xDpi} DPI` : `${xDpi} × ${yDpi} DPI (X × Y)`;
  return geometry.densitySource === 'embedded'
    ? `embedded density ${axes}`
    : `default ${axes} — no usable embedded density`;
}

function validDpi(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}
