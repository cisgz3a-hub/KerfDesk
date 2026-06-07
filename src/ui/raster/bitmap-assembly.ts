// Shared Convert-to-Bitmap assembly. Main-thread and worker callers both use
// this file so Render Type / DPI / source metadata cannot drift.

import { rasterizeVectorToLuma, type VectorRaster } from '../../core/raster';
import {
  DEFAULT_RASTER_LAYER_COLOR,
  type DitherAlgorithm,
  type ImportedSvg,
  type LayerMode,
  type Polyline,
  type RasterImage,
  type SceneObject,
  type TextObject,
  type TracedImage,
} from '../../core/scene';
import {
  assertBitmapConversionFits,
  estimateBitmapConversion,
  type BitmapConversionPlan,
} from './bitmap-conversion-plan';
import type { BitmapFields } from './luma-bitmap';

const DEFAULT_DITHER: DitherAlgorithm = 'floyd-steinberg';
const BITMAP_SOURCE_SUFFIX = ' (bitmap)';

export type ConvertibleVector = ImportedSvg | TextObject | TracedImage;
export type ConvertToBitmapRenderType = 'fill-all' | 'outlines' | 'use-cut-settings';
export type BitmapLayerSetting = {
  readonly color: string;
  readonly mode: LayerMode;
};
export type BitmapConversionOptions = {
  readonly dpi?: number;
  readonly renderType?: ConvertToBitmapRenderType;
  readonly layers?: ReadonlyArray<BitmapLayerSetting>;
};

export function isConvertibleVector(o: SceneObject): o is ConvertibleVector {
  return o.kind === 'imported-svg' || o.kind === 'text' || o.kind === 'traced-image';
}

export function assembleBitmap(
  o: ConvertibleVector,
  encode: (raster: VectorRaster) => BitmapFields,
  id: string,
  options: BitmapConversionOptions = {},
): RasterImage {
  const { plan, raster } = rasterizeConvertible(o, options);
  const fields = encode(raster);
  return buildRasterImage(o, id, plan, raster, fields);
}

export async function assembleBitmapAsync(
  o: ConvertibleVector,
  encode: (raster: VectorRaster) => Promise<BitmapFields>,
  id: string,
  options: BitmapConversionOptions = {},
): Promise<RasterImage> {
  const { plan, raster } = rasterizeConvertible(o, options);
  const fields = await encode(raster);
  return buildRasterImage(o, id, plan, raster, fields);
}

function rasterizeConvertible(
  o: ConvertibleVector,
  options: BitmapConversionOptions,
): {
  readonly plan: BitmapConversionPlan;
  readonly raster: VectorRaster;
} {
  const plan = estimateBitmapConversion(o, options.dpi);
  assertBitmapConversionFits(plan);
  const { fillPolylines, outlinePolylines } = conversionPolylineGroups(o, options);
  const raster = rasterizeVectorToLuma({
    polylines: o.paths.flatMap((p) => p.polylines),
    fillPolylines,
    outlinePolylines,
    bounds: o.bounds,
    pixelWidth: plan.pixelWidth,
    pixelHeight: plan.pixelHeight,
  });
  return { plan, raster };
}

function conversionPolylineGroups(
  o: ConvertibleVector,
  options: BitmapConversionOptions,
): {
  readonly fillPolylines: ReadonlyArray<Polyline>;
  readonly outlinePolylines: ReadonlyArray<Polyline>;
} {
  const renderType = options.renderType ?? 'fill-all';
  if (renderType === 'fill-all') {
    return { fillPolylines: o.paths.flatMap((p) => p.polylines), outlinePolylines: [] };
  }
  if (renderType === 'outlines') {
    return { fillPolylines: [], outlinePolylines: o.paths.flatMap((p) => p.polylines) };
  }
  const layerModes = new Map(options.layers?.map((l) => [l.color.toLowerCase(), l.mode]) ?? []);
  const fillPolylines: Polyline[] = [];
  const outlinePolylines: Polyline[] = [];
  for (const path of o.paths) {
    const mode = layerModes.get(path.color.toLowerCase()) ?? 'line';
    if (mode === 'fill') fillPolylines.push(...path.polylines);
    else outlinePolylines.push(...path.polylines);
  }
  return { fillPolylines, outlinePolylines };
}

function buildRasterImage(
  o: ConvertibleVector,
  id: string,
  plan: BitmapConversionPlan,
  raster: VectorRaster,
  fields: BitmapFields,
): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${sourceLabel(o)}${BITMAP_SOURCE_SUFFIX}`,
    dataUrl: fields.dataUrl,
    pixelWidth: raster.width,
    pixelHeight: raster.height,
    bounds: o.bounds,
    transform: o.transform,
    color: DEFAULT_RASTER_LAYER_COLOR,
    dither: DEFAULT_DITHER,
    linesPerMm: plan.linesPerMm,
    lumaBase64: fields.lumaBase64,
  };
}

function sourceLabel(o: ConvertibleVector): string {
  return 'source' in o ? o.source : o.content;
}
