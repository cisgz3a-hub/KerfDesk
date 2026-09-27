// The placed (millimetre) size of each Multi-File Trace file (ADR-409). By
// default it is the import size: the file's embedded density when it has one,
// the default bitmap DPI otherwise, exactly as Import Image sizes it. The Size
// row (rank 33) can instead give every file one DPI or one width in mm; the
// height then follows the file's own aspect ratio.

import type { ImageDensity } from '../common/image-density';
import { rasterImportGeometry, type RasterImportGeometry } from '../common/image-import';

const MM_PER_INCH = 25.4;

/** One size for every file in the batch; omitted, each file's own size. */
export type MultiFileTraceSize =
  | { readonly kind: 'dpi'; readonly dpi: number }
  | { readonly kind: 'width'; readonly widthMm: number };

/** Where a file's size came from; 'override' is the Size row. */
export type MultiFileDensitySource = RasterImportGeometry['densitySource'] | 'override';

export type SizedFile = {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly densitySource: MultiFileDensitySource;
};

type PixelSize = { readonly width: number; readonly height: number };

/** The file's import size from its pixel size and embedded density. */
export function physicalSizeMm(natural: PixelSize, density: ImageDensity | null): SizedFile {
  const geometry = rasterImportGeometry({
    naturalWidth: natural.width,
    naturalHeight: natural.height,
    sampledWidth: natural.width,
    sampledHeight: natural.height,
    density,
  });
  return {
    widthMm: geometry.bounds.maxX - geometry.bounds.minX,
    heightMm: geometry.bounds.maxY - geometry.bounds.minY,
    densitySource: geometry.densitySource,
  };
}

/** The Size row's size for a file of this pixel size, or null for none. */
export function overriddenSizeMm(
  natural: PixelSize,
  size: MultiFileTraceSize | undefined,
): SizedFile | null {
  if (size === undefined || !(natural.width > 0) || !(natural.height > 0)) return null;
  if (size.kind === 'dpi') {
    if (!(size.dpi > 0)) return null;
    const mmPerPx = MM_PER_INCH / size.dpi;
    return {
      widthMm: natural.width * mmPerPx,
      heightMm: natural.height * mmPerPx,
      densitySource: 'override',
    };
  }
  if (!(size.widthMm > 0)) return null;
  return {
    widthMm: size.widthMm,
    heightMm: (size.widthMm * natural.height) / natural.width,
    densitySource: 'override',
  };
}
