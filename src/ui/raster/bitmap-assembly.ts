// Shared Convert-to-Bitmap assembly. Main-thread and worker callers both use
// this file so Render Type / DPI / source metadata cannot drift.

import {
  inkLumaForBrightnessPercent,
  rasterizeVectorToLuma,
  type VectorRaster,
} from '../../core/raster';
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
  // LightBurn's Default Brightness (§7.4): the gray level inked pixels start
  // at, as a percentage. Omitted → 50% (which maps to luma 127, M7).
  readonly brightnessPercent?: number;
};

export function isConvertibleVector(o: SceneObject): o is ConvertibleVector {
  return (
    o.kind === 'imported-svg' ||
    o.kind === 'text' ||
    o.kind === 'traced-image' ||
    o.kind === 'shape'
  );
}

// Conversion works on the whole selection at once — LightBurn's Convert to
// Bitmap merges a multi-selection into ONE bitmap (ADR-029 amendment ii).
export function bitmapConversionTarget(
  objects: ReadonlyArray<ConvertibleVector>,
): BitmapConversionTarget {
  return { bounds: combinedConvertibleBounds(objects), transform: IDENTITY_TRANSFORM };
}

// Display name for a conversion: the object's own label, or a count for a
// multi-selection merge.
export function conversionSourceLabel(objects: ReadonlyArray<ConvertibleVector>): string {
  const first = objects[0];
  if (objects.length === 1 && first !== undefined) return sourceLabel(first);
  return `${objects.length} objects`;
}

export function assembleBitmap(
  objects: ReadonlyArray<ConvertibleVector>,
  encode: (raster: VectorRaster) => BitmapFields,
  id: string,
  options: BitmapConversionOptions = {},
): RasterImage {
  const { bounds, plan, raster } = rasterizeConvertibles(objects, options);
  const fields = encode(raster);
  return buildRasterImage(objects, id, bounds, plan, raster, fields);
}

export async function assembleBitmapAsync(
  objects: ReadonlyArray<ConvertibleVector>,
  encode: (raster: VectorRaster) => Promise<BitmapFields>,
  id: string,
  options: BitmapConversionOptions = {},
): Promise<RasterImage> {
  const { bounds, plan, raster } = rasterizeConvertibles(objects, options);
  const fields = await encode(raster);
  return buildRasterImage(objects, id, bounds, plan, raster, fields);
}

function rasterizeConvertibles(
  objects: ReadonlyArray<ConvertibleVector>,
  options: BitmapConversionOptions,
): {
  readonly bounds: Bounds;
  readonly plan: BitmapConversionPlan;
  readonly raster: VectorRaster;
} {
  // Bake every object into scene space and rasterize the concatenated
  // contours as ONE even-odd render. Cross-object even-odd is deliberate:
  // it matches both LightBurn's "areas between outlines" Fill All and our
  // own Fill mode, which hatches a layer's contours together — a shape
  // nested inside another object's shape reads as a hole.
  const baked = objects.map(bakeConvertibleTransform);
  const bounds = combinedConvertibleBounds(objects);
  const paths = baked.flatMap((b) => b.paths);
  const plan = estimateBitmapConversion({ bounds, transform: IDENTITY_TRANSFORM }, options.dpi);
  assertBitmapConversionFits(plan);
  const { fillPolylines, outlinePolylines } = conversionPolylineGroups(paths, options);
  const raster = rasterizeVectorToLuma({
    polylines: paths.flatMap((p) => p.polylines),
    fillPolylines,
    outlinePolylines,
    bounds,
    pixelWidth: plan.pixelWidth,
    pixelHeight: plan.pixelHeight,
    ...(options.brightnessPercent !== undefined
      ? { inkLuma: inkLumaForBrightnessPercent(options.brightnessPercent) }
      : {}),
  });
  return { bounds, plan, raster };
}

// Union of the selection's transformed (rotation-aware) AABBs. Callers gate
// on a non-empty convertible selection; an empty array degrades to a zero
// rect, which the raster budget then rejects as invalid.
function combinedConvertibleBounds(objects: ReadonlyArray<ConvertibleVector>): Bounds {
  let bounds: Bounds | null = null;
  for (const o of objects) {
    const b = transformedBBox(o);
    bounds =
      bounds === null
        ? b
        : {
            minX: Math.min(bounds.minX, b.minX),
            minY: Math.min(bounds.minY, b.minY),
            maxX: Math.max(bounds.maxX, b.maxX),
            maxY: Math.max(bounds.maxY, b.maxY),
          };
  }
  return bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
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
  objects: ReadonlyArray<ConvertibleVector>,
  id: string,
  bounds: Bounds,
  plan: BitmapConversionPlan,
  raster: VectorRaster,
  fields: BitmapFields,
): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${conversionSourceLabel(objects)}${BITMAP_SOURCE_SUFFIX}`,
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

/** Display name for a convertible vector: filename, text content, or shape kind. */
export function sourceLabel(o: ConvertibleVector): string {
  if ('source' in o) return o.source;
  if ('content' in o) return o.content;
  return `${o.spec.kind} shape`;
}
