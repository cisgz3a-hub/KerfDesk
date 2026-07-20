import { MAX_RASTER_LINES_PER_MM, MM_PER_INCH, linesPerMmToDpi } from '../../core/raster';
import {
  layerFromSubLayer,
  sceneObjectUsesOperation,
  type Layer,
  type LayerSubLayer,
  type Project,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { buildBitmapFromVectors } from '../raster/vector-to-bitmap';
import { positionTraceOverRasterSource } from '../state/scene-mutations';

export type RasterTraceOperationInput = {
  readonly operation: Layer;
  readonly sourceLayer: Layer;
  readonly sourceSubLayer?: LayerSubLayer;
};

export type RasterTraceInputs = {
  readonly source: RasterImage;
  readonly operations: ReadonlyArray<RasterTraceOperationInput>;
};

/** Resolve the live bitmap and every active bound Image operation. Returning
 * the actual source references lets the caller detect any transform, content,
 * binding, parent-operation, or sub-operation edit made while the asynchronous
 * bitmap worker is running. */
export function rasterTraceInputs(project: Project, sourceId: string): RasterTraceInputs | null {
  const source = project.scene.objects.find((object) => object.id === sourceId);
  if (source === undefined || source.kind !== 'raster-image') return null;
  const operations: RasterTraceOperationInput[] = [];
  for (const sourceLayer of project.scene.layers) {
    operations.push(...imageOperationInputs(source, sourceLayer));
  }
  return operations.length === 0 ? null : { source, operations };
}

export function sameRasterTraceInputs(project: Project, expected: RasterTraceInputs): boolean {
  const current = rasterTraceInputs(project, expected.source.id);
  return (
    current?.source === expected.source &&
    current.operations.length === expected.operations.length &&
    current.operations.every((operation, index) => {
      const previous = expected.operations[index];
      return (
        previous !== undefined &&
        operation.sourceLayer === previous.sourceLayer &&
        operation.sourceSubLayer === previous.sourceSubLayer
      );
    })
  );
}

function imageOperationInputs(
  source: RasterImage,
  sourceLayer: Layer,
): ReadonlyArray<RasterTraceOperationInput> {
  if (!sourceLayer.output || !sceneObjectUsesOperation(source, sourceLayer)) return [];
  const operations: RasterTraceOperationInput[] = [];
  if ((source.operationOverride?.mode ?? sourceLayer.mode) === 'image') {
    operations.push({ operation: sourceLayer, sourceLayer });
  }
  for (const sourceSubLayer of sourceLayer.subLayers) {
    if (!sourceSubLayer.enabled) continue;
    const operation = layerFromSubLayer(sourceLayer, sourceSubLayer);
    if ((source.operationOverride?.mode ?? operation.mode) === 'image') {
      operations.push({ operation, sourceLayer, sourceSubLayer });
    }
  }
  return operations;
}

/** Rasterize the positioned trace into an ordinary RasterImage. The vector
 * geometry is baked into scene-space pixels, including rotation, mirroring,
 * and non-uniform scaling, so the final image can use an identity transform. */
export async function buildRasterTraceOutput(
  source: RasterImage,
  traced: TracedImage,
  operations: ReadonlyArray<Layer>,
): Promise<RasterImage> {
  const positioned = positionTraceOverRasterSource(source, traced);
  const linesPerMm = rasterTraceLinesPerMm(source, traced, operations);
  const renderType = traced.traceMode === 'filled-contours' ? 'fill-all' : 'outlines';
  const conversionSource =
    renderType === 'outlines' ? padTraceForOutlineRaster(positioned, linesPerMm) : positioned;
  const raster = await buildBitmapFromVectors([conversionSource], {
    dpi: linesPerMmToDpi(linesPerMm),
    renderType,
    brightnessPercent: 0,
  });
  return { ...raster, id: traced.id };
}

/** Use enough pixels for every scan that will consume the committed bitmap.
 * Pass Through ignores operation density at compile time, so the trace working
 * grid becomes an additional lower bound. Refuse an unsupported grid rather
 * than silently materializing a lower-resolution bitmap. */
export function rasterTraceLinesPerMm(
  source: RasterImage,
  traced: TracedImage,
  operations: ReadonlyArray<Layer>,
): number {
  if (operations.length === 0) throw new Error('Raster trace has no active Image operation.');
  const densities = operations.map((operation) =>
    normalizedLinesPerMm(source.operationOverride?.linesPerMm ?? operation.linesPerMm),
  );
  if (!operations.some((operation) => effectivePassThrough(source, operation))) {
    return Math.max(...densities);
  }
  const nativeDensity = nativeTraceLinesPerMm(source, traced);
  if (nativeDensity > MAX_RASTER_LINES_PER_MM + 1e-6) {
    throw new Error(
      `Pass Through needs ${nativeDensity.toFixed(2)} lines/mm to preserve this trace grid, above the supported ${MAX_RASTER_LINES_PER_MM} lines/mm. Disable Pass Through, resize the image, or choose Editable vectors.`,
    );
  }
  return Math.max(nativeDensity, ...densities);
}

function effectivePassThrough(source: RasterImage, operation: Layer): boolean {
  return source.operationOverride?.passThrough ?? operation.passThrough;
}

function nativeTraceLinesPerMm(source: RasterImage, traced: TracedImage): number {
  const widthMm = Math.abs((source.bounds.maxX - source.bounds.minX) * source.transform.scaleX);
  const heightMm = Math.abs((source.bounds.maxY - source.bounds.minY) * source.transform.scaleY);
  const traceWidth = positiveGridDimension(traced.tracePixelWidth, source.pixelWidth);
  const traceHeight = positiveGridDimension(traced.tracePixelHeight, source.pixelHeight);
  const densities = [traceWidth / widthMm, traceHeight / heightMm];
  if (densities.some((density) => !Number.isFinite(density) || density <= 0)) {
    throw new Error(
      'Pass Through cannot preserve a trace grid with an empty or invalid physical size. Resize the image before tracing.',
    );
  }
  return Math.max(...densities);
}

function positiveGridDimension(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizedLinesPerMm(linesPerMm: number): number {
  return linesPerMmToDpi(linesPerMm) / MM_PER_INCH;
}

/** Give one-dimensional trace strokes a real physical raster extent and keep
 * all outline ink away from the conversion edge. Padding is expressed as half
 * a target pixel in scene millimetres, then mapped back through the trace's
 * local X/Y scales so rotation, mirroring, and non-uniform scale stay baked. */
export function padTraceForOutlineRaster(traced: TracedImage, linesPerMm: number): TracedImage {
  const halfPixelMm = MM_PER_INCH / (2 * linesPerMmToDpi(linesPerMm));
  const padX = localPadding(halfPixelMm, traced.transform.scaleX);
  const padY = localPadding(halfPixelMm, traced.transform.scaleY);
  return {
    ...traced,
    bounds: {
      minX: traced.bounds.minX - padX,
      minY: traced.bounds.minY - padY,
      maxX: traced.bounds.maxX + padX,
      maxY: traced.bounds.maxY + padY,
    },
  };
}

function localPadding(scenePadding: number, scale: number): number {
  const magnitude = Math.abs(scale);
  return Number.isFinite(magnitude) && magnitude > 0 ? scenePadding / magnitude : 0;
}
