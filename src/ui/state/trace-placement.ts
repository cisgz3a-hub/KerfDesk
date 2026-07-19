import { applyTransform, type RasterImage, type TracedImage } from '../../core/scene';

/** Register trace-grid geometry over the complete imported raster. */
export function positionTraceOverRasterSource(
  source: RasterImage,
  traced: TracedImage,
): TracedImage {
  const traceWidth = positiveDimension(traced.tracePixelWidth, source.pixelWidth);
  const traceHeight = positiveDimension(traced.tracePixelHeight, source.pixelHeight);
  if (traceWidth === null || traceHeight === null) {
    return { ...traced, traceSourceId: source.id, transform: source.transform };
  }

  const widthMm = source.bounds.maxX - source.bounds.minX;
  const heightMm = source.bounds.maxY - source.bounds.minY;
  const origin = applyTransform({ x: source.bounds.minX, y: source.bounds.minY }, source.transform);
  return {
    ...traced,
    traceSourceId: source.id,
    transform: {
      ...source.transform,
      x: origin.x,
      y: origin.y,
      scaleX: source.transform.scaleX * (widthMm / traceWidth),
      scaleY: source.transform.scaleY * (heightMm / traceHeight),
    },
  };
}

function positiveDimension(value: number | undefined, fallback: number): number | null {
  const candidate = value ?? fallback;
  return Number.isFinite(candidate) && candidate > 0 ? candidate : null;
}
