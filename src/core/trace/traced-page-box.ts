// Page choice for Multi-File Trace output (ADR-451).
//
// 'image' (the default) keeps the source image rectangle as the page, so
// every file stays in register with the image it came from and the output is
// unchanged. 'artwork' fits the page to the exact extent of the traced curves
// (curveSubpathBounds: derivative roots, not control points, so a cubic that
// bulges past its end points is inside and a control point off the curve does
// not widen the page), grows it by the margin on every side, and moves the
// artwork so the fitted page's top-left corner is the origin. Stroked curves
// (Centerline, open curves) add half the widest hairline any writer draws, so
// a stroke on the fitted edge is not clipped. The scale (millimetres per
// source pixel) is untouched: only the page and the offset change.
//
// On a physical page the fitted box is rounded outward to the export grid, so
// the offset is a whole number of grid steps and a coordinate differs from the
// image-page file by that exact offset. A page with no physical size (only
// direct core callers: the app always knows the image density) is in source
// pixels and takes the margin in pixels.
//
// Pure-core compliant: no clock, no random, no I/O, no DOM.

import { curveSubpathBounds } from '../scene/curve-path';
import { transformCurveSubpathExact } from '../vector-export/affine-curves';
import {
  DEFAULT_EXPORT_PRECISION_MM,
  decimalGridAtMost,
  formatGridIndex,
  outwardGridIndices,
} from '../vector-export/decimal-grid';
import type { TracedLayer, TracedSvgPage } from './batch-trace-svg';
import type { TraceOptions } from './trace-option-types';

export type TracedPageFit = 'image' | 'artwork';

export type TracedPageLayout = {
  readonly fit: TracedPageFit;
  /** Space around the fitted artwork on every side, in millimetres. */
  readonly marginMm?: number;
};

/**
 * The widest stroke a traced writer draws on a physical page, in mm: the PDF
 * and EPS hairline (io vector-artwork VECTOR_STROKE_WIDTH_MM). The SVG draws
 * one source pixel, which is also covered.
 */
export const TRACED_HAIRLINE_MM = 0.1;

/** A page rectangle in page units (mm when physical, else px), Y down. */
export type TracedPageBox = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type PlacedTrace = {
  readonly layers: ReadonlyArray<TracedLayer>;
  readonly page: TracedSvgPage;
};

/** Largest accepted margin, in mm (one metre each side). */
export const MAX_TRACED_PAGE_MARGIN_MM = 1000;

/**
 * Put traced layers on the requested page. The image page returns the input
 * unchanged, so its output stays byte-identical.
 */
export function placeTracedLayers(
  layers: ReadonlyArray<TracedLayer>,
  page: TracedSvgPage,
  traceMode: TraceOptions['traceMode'],
  layout: TracedPageLayout | undefined,
  precisionMm: number | undefined,
): PlacedTrace {
  if (layout === undefined || layout.fit === 'image') return { layers, page };
  const box = fittedPageBox(layers, page, traceMode, layout.marginMm ?? 0, precisionMm);
  if (box === null) return { layers, page };
  const matrix = { a: 1, b: 0, c: 0, d: 1, e: -box.minX, f: -box.minY };
  return {
    layers: layers.map((layer) => ({
      color: layer.color,
      curves: layer.curves.map((curve) => transformCurveSubpathExact(curve, matrix)),
    })),
    page: { ...page, size: { width: span(box.minX, box.maxX), height: span(box.minY, box.maxY) } },
  };
}

/**
 * The fitted page in the image frame: exact curve extent, stroke allowance
 * and margin, rounded outward to the export grid on a physical page. Null when
 * no curve has any extent to fit.
 */
export function fittedPageBox(
  layers: ReadonlyArray<TracedLayer>,
  page: TracedSvgPage,
  traceMode: TraceOptions['traceMode'],
  marginMm: number,
  precisionMm: number | undefined,
): TracedPageBox | null {
  const extent = curveExtent(layers);
  if (extent === null) return null;
  const physical = page.physicalSizeMm !== undefined;
  const pad = strokedAnywhere(layers, traceMode) ? strokeAllowance(page) : 0;
  const margin = Number.isFinite(marginMm)
    ? Math.min(Math.max(marginMm, 0), MAX_TRACED_PAGE_MARGIN_MM)
    : 0;
  const grow = pad + margin;
  const raw = {
    minX: extent.minX - grow,
    minY: extent.minY - grow,
    maxX: extent.maxX + grow,
    maxY: extent.maxY + grow,
  };
  if (!physical) return raw;
  const grid = decimalGridAtMost(precisionMm ?? DEFAULT_EXPORT_PRECISION_MM);
  const x = outwardGridIndices(raw.minX, raw.maxX, grid);
  const y = outwardGridIndices(raw.minY, raw.maxY, grid);
  // Keep at least one grid step on each side so a single dot still has a page.
  const onGrid = (index: number): number => Number(formatGridIndex(index, grid));
  return {
    minX: onGrid(x.lo),
    minY: onGrid(y.lo),
    maxX: onGrid(Math.max(x.hi, x.lo + 1)),
    maxY: onGrid(Math.max(y.hi, y.lo + 1)),
  };
}

// Grid values are at most 4 decimals, so 12 places strip binary noise from the difference.
function span(min: number, max: number): number {
  return Number((max - min).toFixed(12));
}

function curveExtent(layers: ReadonlyArray<TracedLayer>): TracedPageBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const layer of layers) {
    for (const curve of layer.curves) {
      if (curve.segments.length === 0) continue;
      const b = curveSubpathBounds(curve);
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
}

function strokedAnywhere(
  layers: ReadonlyArray<TracedLayer>,
  traceMode: TraceOptions['traceMode'],
): boolean {
  if (traceMode === 'centerline') return layers.some((layer) => layer.curves.length > 0);
  return layers.some((layer) => layer.curves.some((curve) => !curve.closed));
}

/** Half the widest stroke drawn on this page, in page units. */
function strokeAllowance(page: TracedSvgPage): number {
  const size = page.physicalSizeMm;
  if (size === undefined || !(page.pixelWidth > 0) || !(page.pixelHeight > 0)) return 0.5;
  const pixel = Math.max(size.widthMm / page.pixelWidth, size.heightMm / page.pixelHeight);
  return Math.max(pixel, TRACED_HAIRLINE_MM) / 2;
}
