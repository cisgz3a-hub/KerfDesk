// Shared Convert-to-Bitmap assembly. Main-thread and worker callers both use
// this file so Render Type / DPI / source metadata cannot drift.

import { rasterizeVectorToLuma, type VectorRaster } from '../../core/raster';
import {
  DEFAULT_RASTER_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  applyTransform,
  transformedBBox,
  type Bounds,
  type ColoredPath,
  type DitherAlgorithm,
  type ImportedSvg,
  type LayerMode,
  type Polyline,
  type RasterImage,
  type SceneObject,
  type ShapeObject,
  type TextObject,
  type TracedImage,
} from '../../core/scene';
import {
  assertBitmapConversionFits,
  estimateBitmapConversion,
  type BitmapConversionPlan,
  type BitmapConversionTarget,
} from './bitmap-conversion-plan';
import type { BitmapFields } from './luma-bitmap';

const DEFAULT_DITHER: DitherAlgorithm = 'floyd-steinberg';
const BITMAP_SOURCE_SUFFIX = ' (bitmap)';

export type ConvertibleVector = ImportedSvg | TextObject | TracedImage | ShapeObject;
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
  return (
    o.kind === 'imported-svg' ||
    o.kind === 'text' ||
    o.kind === 'traced-image' ||
    o.kind === 'shape'
  );
}

export function bitmapConversionTarget(o: ConvertibleVector): BitmapConversionTarget {
  return { bounds: transformedBBox(o), transform: IDENTITY_TRANSFORM };
}

export function assembleBitmap(
  o: ConvertibleVector,
  encode: (raster: VectorRaster) => BitmapFields,
  id: string,
  options: BitmapConversionOptions = {},
): RasterImage {
  const { bounds, plan, raster } = rasterizeConvertible(o, options);
  const fields = encode(raster);
  return buildRasterImage(o, id, bounds, plan, raster, fields);
}

export async function assembleBitmapAsync(
  o: ConvertibleVector,
  encode: (raster: VectorRaster) => Promise<BitmapFields>,
  id: string,
  options: BitmapConversionOptions = {},
): Promise<RasterImage> {
  const { bounds, plan, raster } = rasterizeConvertible(o, options);
  const fields = await encode(raster);
  return buildRasterImage(o, id, bounds, plan, raster, fields);
}

function rasterizeConvertible(
  o: ConvertibleVector,
  options: BitmapConversionOptions,
): {
  readonly bounds: Bounds;
  readonly plan: BitmapConversionPlan;
  readonly raster: VectorRaster;
} {
  const baked = bakeConvertibleTransform(o);
  const plan = estimateBitmapConversion(
    { bounds: baked.bounds, transform: IDENTITY_TRANSFORM },
    options.dpi,
  );
  assertBitmapConversionFits(plan);
  const { fillPolylines, outlinePolylines } = conversionPolylineGroups(baked.paths, options);
  const raster = rasterizeVectorToLuma({
    polylines: baked.paths.flatMap((p) => p.polylines),
    fillPolylines,
    outlinePolylines,
    bounds: baked.bounds,
    pixelWidth: plan.pixelWidth,
    pixelHeight: plan.pixelHeight,
  });
  return { bounds: baked.bounds, plan, raster };
}

function conversionPolylineGroups(
  paths: ReadonlyArray<ColoredPath>,
  options: BitmapConversionOptions,
): {
  readonly fillPolylines: ReadonlyArray<Polyline>;
  readonly outlinePolylines: ReadonlyArray<Polyline>;
} {
  const renderType = options.renderType ?? 'fill-all';
  if (renderType === 'fill-all') {
    return { fillPolylines: paths.flatMap((p) => p.polylines), outlinePolylines: [] };
  }
  if (renderType === 'outlines') {
    return { fillPolylines: [], outlinePolylines: paths.flatMap((p) => p.polylines) };
  }
  const layerModes = new Map(options.layers?.map((l) => [l.color.toLowerCase(), l.mode]) ?? []);
  const fillPolylines: Polyline[] = [];
  const outlinePolylines: Polyline[] = [];
  for (const path of paths) {
    const mode = layerModes.get(path.color.toLowerCase()) ?? 'line';
    if (mode === 'fill') fillPolylines.push(...path.polylines);
    else outlinePolylines.push(...path.polylines);
  }
  return { fillPolylines, outlinePolylines };
}

function bakeConvertibleTransform(o: ConvertibleVector): {
  readonly bounds: Bounds;
  readonly paths: ReadonlyArray<ColoredPath>;
} {
  return {
    bounds: transformedBBox(o),
    paths: o.paths.map((path) => ({
      color: path.color,
      polylines: path.polylines.map((polyline) => ({
        closed: polyline.closed,
        points: polyline.points.map((point) => applyTransform(point, o.transform)),
      })),
    })),
  };
}

function buildRasterImage(
  o: ConvertibleVector,
  id: string,
  bounds: Bounds,
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
    bounds,
    transform: IDENTITY_TRANSFORM,
    color: DEFAULT_RASTER_LAYER_COLOR,
    dither: DEFAULT_DITHER,
    linesPerMm: plan.linesPerMm,
    lumaBase64: fields.lumaBase64,
  };
}

function sourceLabel(o: ConvertibleVector): string {
  if ('source' in o) return o.source;
  if ('content' in o) return o.content;
  return `${o.spec.kind} shape`;
}
