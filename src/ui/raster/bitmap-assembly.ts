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
  type Polyline,
  type RasterImage,
  type SceneObject,
  type ShapeObject,
  type TextObject,
  type TracedImage,
  type Transform,
} from '../../core/scene';
import { flattenColoredPathCurvesForTransform } from '../../core/scene/curve-path';
import {
  assertBitmapConversionFits,
  estimateBitmapConversion,
  type BitmapConversionPlan,
  type BitmapConversionTarget,
} from './bitmap-conversion-plan';
import type { BitmapFields } from './luma-bitmap';
import { bitmapFillGroups, type BitmapFillObject } from './bitmap-fill-groups';
import { estimateBitmapGeometryResources } from './bitmap-conversion-resources';
import type { BitmapLayerSetting } from './bitmap-operation-settings';

export type { BitmapLayerSetting } from './bitmap-operation-settings';

const DEFAULT_DITHER: DitherAlgorithm = 'floyd-steinberg';
const BITMAP_SOURCE_SUFFIX = ' (bitmap)';
const CURVE_TOLERANCE_PIXELS = 0.25;

export type ConvertibleVector = ImportedSvg | TextObject | TracedImage | ShapeObject;
export type ConvertToBitmapRenderType = 'fill-all' | 'outlines' | 'use-cut-settings';
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
  return {
    bounds: combinedConvertibleBounds(objects),
    transform: IDENTITY_TRANSFORM,
    geometryStats: estimateBitmapGeometryResources(objects),
  };
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
  const plan = estimateBitmapConversion(bitmapConversionTarget(objects), options.dpi);
  assertBitmapConversionFits(plan);
  const bounds = plan.bounds;
  // Resolve canonical geometry at the actual rounded pixel pitch, in scene mm.
  // The flattener accounts for each object's largest axis scale before baking.
  const toleranceMm =
    CURVE_TOLERANCE_PIXELS *
    Math.min(
      (bounds.maxX - bounds.minX) / plan.pixelWidth,
      (bounds.maxY - bounds.minY) / plan.pixelHeight,
    );
  const budget = { remaining: plan.maxFlattenedSegments };
  const baked = objects.map((object) => bakeConvertibleTransform(object, toleranceMm, budget));
  const { fillGroups, outlinePolylines } = bitmapFillGroups(baked, options);
  const raster = rasterizeVectorToLuma({
    polylines: [],
    fillGroups,
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
// on a non-empty convertible selection; invalid empty input is refused.
function combinedConvertibleBounds(objects: ReadonlyArray<ConvertibleVector>): Bounds {
  let bounds: Bounds | null = null;
  for (const o of objects) {
    if (!validSourceBounds(o.bounds)) return { minX: NaN, minY: NaN, maxX: NaN, maxY: NaN };
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
  return bounds ?? { minX: NaN, minY: NaN, maxX: NaN, maxY: NaN };
}

function validSourceBounds(bounds: Bounds): boolean {
  return (
    Object.values(bounds).every(Number.isFinite) &&
    bounds.minX <= bounds.maxX &&
    bounds.minY <= bounds.maxY
  );
}

function bakeConvertibleTransform(
  o: ConvertibleVector,
  toleranceMm: number,
  budget: { remaining: number },
): BitmapFillObject {
  return {
    ...(o.operationOverride === undefined ? {} : { operationOverride: o.operationOverride }),
    paths: o.paths.map((path) => {
      const operationIds = path.operationIds ?? o.operationIds;
      const polylines = flattenBitmapPath(path, o.transform, toleranceMm, budget);
      return {
        color: path.color,
        fillRule: path.fillRule ?? (o.kind === 'text' ? 'nonzero' : 'evenodd'),
        ...(operationIds === undefined ? {} : { operationIds }),
        polylines: polylines.map((polyline) => ({
          closed: polyline.closed,
          points: polyline.points.map((point) => applyTransform(point, o.transform)),
        })),
      };
    }),
  };
}

function flattenBitmapPath(
  path: ColoredPath,
  transform: Transform,
  toleranceMm: number,
  budget: { remaining: number },
): ReadonlyArray<Polyline> {
  const flatten = (part: ColoredPath): ReadonlyArray<Polyline> => {
    const result = flattenColoredPathCurvesForTransform(part, transform, {
      toleranceMm,
      segmentBudget: Math.max(1, budget.remaining),
    });
    if (result.kind !== 'ok' || result.segmentCount > budget.remaining) {
      throw new Error(
        'Converted bitmap geometry exceeds the conversion memory budget. Lower DPI or simplify the artwork.',
      );
    }
    budget.remaining -= result.segmentCount;
    return result.polylines;
  };
  if (path.curves === undefined) return flatten(path);
  const polylines: Polyline[] = [];
  // Enforce the shared remainder after every subpath. The generic flattener
  // clamps each subpath's allowance to one, so passing a whole multi-subpath
  // path could temporarily exceed a just-exhausted request budget.
  for (const curve of path.curves) {
    polylines.push(...flatten({ color: path.color, polylines: [], curves: [curve] }));
  }
  return polylines;
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
