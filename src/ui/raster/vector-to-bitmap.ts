// ADR-029 Convert to Bitmap — the UI builder that turns a selected vector
// object into the RasterImage the pure scene-mutation (applyConvertToBitmap)
// then swaps in. It bridges the two halves already built: the pure-core
// rasterizer (rasterizeVectorToLuma, A1) and the canvas encoder (lumaToBitmap,
// A2-ii). A1 scope is Fill All only, so this passes the gathered closed
// contours straight through; Outlines / Use Cut Settings arrive in A3/A4.
//
// What can be converted: the three vector-carrying kinds (imported SVG, text,
// traced image) — each stores its geometry as `paths` (ColoredPath[]) in the
// same mm space as its `bounds`. A RasterImage cannot be converted (it is
// already a bitmap). The built raster copies the source's bounds + transform
// verbatim so it lands exactly where the vector was (the overlay-registration
// invariant the unit test pins).
//
// Testability: assembleBitmap takes the canvas encode step as a parameter so
// the gather + rasterize + field-assembly logic is unit-testable without a DOM
// (jsdom has no real canvas). buildBitmapFromVector is the production wiring —
// real lumaToBitmap + a fresh id — and is exercised in-browser (A2-v).

import { rasterizeVectorToLuma, type VectorRaster } from '../../core/raster';
import { evaluateRasterBudget } from '../../core/raster/raster-budget';
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
import { type BitmapFields, lumaToBitmap } from './luma-bitmap';

const MIN_PIXEL_DIM = 1;
// Match the image-import raster defaults so a converted bitmap engraves exactly
// like an imported one would (candidate de-dup with Toolbar's import handler).
const DEFAULT_DITHER: DitherAlgorithm = 'floyd-steinberg';
// Default conversion density. Oversized conversions are lowered by
// bitmapConversionPlan instead of freezing or forcing the user to guess.
const DEFAULT_LINES_PER_MM = 10;
export const DEFAULT_CONVERT_TO_BITMAP_DPI = DEFAULT_LINES_PER_MM * 25.4;
export const MIN_CONVERT_TO_BITMAP_DPI = 25.4;
export const MAX_CONVERT_TO_BITMAP_DPI = 1200;
const BITMAP_SOURCE_SUFFIX = ' (bitmap)';
const DENSITY_SEARCH_STEPS = 32;

// The vector-carrying SceneObject kinds Convert to Bitmap accepts — all three
// expose `paths` + `bounds` + `transform`, so the gather step is uniform.
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

// Production build: rasterize with the real async canvas encoder and a fresh id.
export function buildBitmapFromVector(
  o: ConvertibleVector,
  options: BitmapConversionOptions = {},
): Promise<RasterImage> {
  return assembleBitmapAsync(o, lumaToBitmap, crypto.randomUUID(), options);
}

// Pure except for the injected `encode` (lumaToBitmap in production, the one
// browser-only step). Flattens the vector's contours, rasterizes them to luma
// at the default DPI, and assembles the RasterImage carrying the source's own
// bounds + transform.
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
  const plan = bitmapConversionPlan(o, options);
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

type BitmapConversionPlan = {
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly linesPerMm: number;
};

function bitmapConversionPlan(
  o: ConvertibleVector,
  options: BitmapConversionOptions,
): BitmapConversionPlan {
  const physicalWidthMm = displayedExtentMm(o.bounds.maxX - o.bounds.minX, o.transform.scaleX);
  const physicalHeightMm = displayedExtentMm(o.bounds.maxY - o.bounds.minY, o.transform.scaleY);
  const requestedLinesPerMm = dpiToLinesPerMm(options.dpi ?? DEFAULT_CONVERT_TO_BITMAP_DPI);
  const defaultPlan = planAtLinesPerMm(physicalWidthMm, physicalHeightMm, requestedLinesPerMm);
  if (evaluateRasterBudget(defaultPlan.pixelWidth, defaultPlan.pixelHeight).kind === 'ok') {
    return defaultPlan;
  }

  let low = 0;
  let high = requestedLinesPerMm;
  for (let i = 0; i < DENSITY_SEARCH_STEPS; i += 1) {
    const mid = (low + high) / 2;
    const trial = planAtLinesPerMm(physicalWidthMm, physicalHeightMm, mid);
    if (evaluateRasterBudget(trial.pixelWidth, trial.pixelHeight).kind === 'ok') {
      low = mid;
    } else {
      high = mid;
    }
  }
  return planAtLinesPerMm(physicalWidthMm, physicalHeightMm, low);
}

export function dpiToLinesPerMm(dpi: number): number {
  const finite = Number.isFinite(dpi) ? dpi : DEFAULT_CONVERT_TO_BITMAP_DPI;
  const clamped = Math.max(MIN_CONVERT_TO_BITMAP_DPI, Math.min(MAX_CONVERT_TO_BITMAP_DPI, finite));
  return clamped / 25.4;
}

function displayedExtentMm(localMm: number, scale: number): number {
  return Math.max(0, localMm) * Math.abs(scale);
}

function planAtLinesPerMm(
  widthMm: number,
  heightMm: number,
  linesPerMm: number,
): BitmapConversionPlan {
  return {
    pixelWidth: convertedPixelExtent(widthMm, linesPerMm),
    pixelHeight: convertedPixelExtent(heightMm, linesPerMm),
    linesPerMm,
  };
}

function convertedPixelExtent(mm: number, linesPerMm: number): number {
  return Math.max(MIN_PIXEL_DIM, Math.round(Math.max(0, mm) * Math.max(0, linesPerMm)));
}

// Display name for the converted bitmap. SVG / traced images carry a `source`
// filename; text carries its `content`.
function sourceLabel(o: ConvertibleVector): string {
  return 'source' in o ? o.source : o.content;
}
