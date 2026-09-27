// Page choice for Multi-File Trace output (ADR-451).
//
// 'image' (the default) keeps the source image rectangle as the page, so
// every file stays in register with the image it came from and the output is
// unchanged. 'artwork' fits the page to the exact extent of the traced curves
// (curveSubpathBounds: derivative roots, not control points, so a cubic that
// bulges past its end points is inside and a control point off the curve does
// not widen the page), grows it by the margin on every side, and moves the
// artwork so the fitted page's top-left corner is the origin. Stroked curves
// (Centerline, Edge, Hybrid strokes, open curves) add half the widest hairline
// any writer draws, so a stroke on the fitted edge is not clipped. The scale
// (millimetres per source pixel) is untouched: only the page and the offset change.
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
  type DecimalGrid,
  decimalGridAtMost,
  formatGridIndex,
  outwardGridIndices,
} from '../vector-export/decimal-grid';
import type { TracedLayer, TracedSvgPage } from './batch-trace-svg';
import type { TraceOptions } from './trace-option-types';
import { isLineTraceMode } from './trace-paint';

// 'paper' (rank 33): a fixed page (A4, Letter or a custom size) with the
// artwork centred in the area inside the margins, offset by whole export grid
// steps. It needs a physical page; a pixel page keeps the image page.
export type TracedPageFit = 'image' | 'artwork' | 'paper';

/** Per-side margins in millimetres. */
export type TracedPageMargins = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

export type TracedPageLayout = {
  readonly fit: TracedPageFit;
  /** Space around the fitted artwork on every side, in millimetres. */
  readonly marginMm?: number;
  /** Per-side margins; when present they replace marginMm. */
  readonly margins?: TracedPageMargins;
  /** The paper page's size in millimetres ('paper' only). */
  readonly paperMm?: { readonly width: number; readonly height: number };
};

/** Standard paper sizes in millimetres, portrait. */
export const TRACED_PAPER_SIZES_MM = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
} as const;

/** Largest accepted paper side, in mm. */
export const MAX_TRACED_PAPER_SIDE_MM = 10000;

/**
 * The widest stroke a traced writer draws on a physical page, in mm: the PDF
 * and EPS hairline (io vector-artwork VECTOR_STROKE_WIDTH_MM). The SVG draws
 * one source pixel, which is also covered. The io test traced-page.test.ts
 * keeps it equal to VECTOR_STROKE_WIDTH_MM.
 */
export const TRACED_HAIRLINE_MM = 0.1;

/**
 * The smallest page side, in mm: 3 pt, the PDF 1.4 minimum that the io PDF
 * and EPS writers enforce (vector-artwork MIN_PAGE_SIDE_PT). A fitted physical
 * page never goes below it, so every format gets the same page. The io test
 * traced-page.test.ts keeps both constants equal.
 */
export const MIN_TRACED_PAGE_SIDE_MM = (3 * 25.4) / 72;

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
  if (layout.fit === 'paper') return placeOnPaper(layers, page, layout, precisionMm);
  const box = fittedPageBox(layers, page, traceMode, pageMargins(layout), precisionMm);
  if (box === null) return { layers, page };
  return {
    layers: translated(layers, -box.minX, -box.minY),
    page: { ...page, size: { width: span(box.minX, box.maxX), height: span(box.minY, box.maxY) } },
  };
}

function translated(
  layers: ReadonlyArray<TracedLayer>,
  dx: number,
  dy: number,
): ReadonlyArray<TracedLayer> {
  const matrix = { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
  return layers.map((layer) => ({
    ...layer,
    curves: layer.curves.map((curve) => transformCurveSubpathExact(curve, matrix)),
  }));
}

/** The layout's margins, each clamped to 0..MAX_TRACED_PAGE_MARGIN_MM. */
export function pageMargins(layout: TracedPageLayout): TracedPageMargins {
  const uniform = clampMargin(layout.marginMm ?? 0);
  const sides = layout.margins;
  if (sides === undefined) return { top: uniform, right: uniform, bottom: uniform, left: uniform };
  return {
    top: clampMargin(sides.top),
    right: clampMargin(sides.right),
    bottom: clampMargin(sides.bottom),
    left: clampMargin(sides.left),
  };
}

function clampMargin(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), MAX_TRACED_PAGE_MARGIN_MM) : 0;
}

// The artwork's centre moves to the centre of the area inside the margins,
// by a whole number of export grid steps, so coordinates differ from the
// image-page file by an exact offset. Artwork larger than that area stays
// centred and runs past it; the page never shrinks to the artwork.
function placeOnPaper(
  layers: ReadonlyArray<TracedLayer>,
  page: TracedSvgPage,
  layout: TracedPageLayout,
  precisionMm: number | undefined,
): PlacedTrace {
  const paper = layout.paperMm;
  if (page.physicalSizeMm === undefined || paper === undefined || !validPaper(paper)) {
    return { layers, page };
  }
  const extent = curveExtent(layers);
  const margins = pageMargins(layout);
  const grid = decimalGridAtMost(precisionMm ?? DEFAULT_EXPORT_PRECISION_MM);
  const onGrid = (value: number): number =>
    Number(formatGridIndex(Math.round(value / grid.step), grid));
  const centreX = margins.left + (paper.width - margins.left - margins.right) / 2;
  const centreY = margins.top + (paper.height - margins.top - margins.bottom) / 2;
  const dx = extent === null ? 0 : onGrid(centreX - (extent.minX + extent.maxX) / 2);
  const dy = extent === null ? 0 : onGrid(centreY - (extent.minY + extent.maxY) / 2);
  return {
    layers: dx === 0 && dy === 0 ? layers : translated(layers, dx, dy),
    page: { ...page, size: { width: paper.width, height: paper.height } },
  };
}

function validPaper(paper: { readonly width: number; readonly height: number }): boolean {
  return [paper.width, paper.height].every(
    (side) => Number.isFinite(side) && side > 0 && side <= MAX_TRACED_PAPER_SIDE_MM,
  );
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
  marginMm: number | TracedPageMargins,
  precisionMm: number | undefined,
): TracedPageBox | null {
  const extent = curveExtent(layers);
  if (extent === null) return null;
  const physical = page.physicalSizeMm !== undefined;
  const pad = strokedAnywhere(layers, traceMode) ? strokeAllowance(page) : 0;
  const m = pageMargins(
    typeof marginMm === 'number'
      ? { fit: 'artwork', marginMm }
      : { fit: 'artwork', margins: marginMm },
  );
  const raw = {
    minX: extent.minX - pad - m.left,
    minY: extent.minY - pad - m.top,
    maxX: extent.maxX + pad + m.right,
    maxY: extent.maxY + pad + m.bottom,
  };
  if (!physical) return raw;
  const grid = decimalGridAtMost(precisionMm ?? DEFAULT_EXPORT_PRECISION_MM);
  const x = atLeastMinimumSide(outwardGridIndices(raw.minX, raw.maxX, grid), grid);
  const y = atLeastMinimumSide(outwardGridIndices(raw.minY, raw.maxY, grid), grid);
  const onGrid = (index: number): number => Number(formatGridIndex(index, grid));
  return { minX: onGrid(x.lo), minY: onGrid(y.lo), maxX: onGrid(x.hi), maxY: onGrid(y.hi) };
}

/**
 * Grow a side shorter than the smallest PDF page side to that side, rounded
 * outward to whole grid steps and centred on the artwork (the extra odd step
 * goes to the high side). The PDF and EPS writers grow a caller's page to the
 * same minimum, so without this a thin fitted page (a Centerline trace of a
 * straight line) would be a different page in PDF/EPS than in SVG, DXF and
 * GeoJSON. At least one grid step always remains, so a single dot has a page.
 */
function atLeastMinimumSide(
  side: { readonly lo: number; readonly hi: number },
  grid: DecimalGrid,
): { readonly lo: number; readonly hi: number } {
  const minimum = Math.max(1, Math.ceil(MIN_TRACED_PAGE_SIDE_MM / grid.step - 1e-9));
  const length = side.hi - side.lo;
  if (length >= minimum) return side;
  const lo = side.lo - Math.floor((minimum - length) / 2);
  return { lo, hi: lo + minimum };
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
  if (isLineTraceMode(traceMode)) return layers.some((layer) => layer.curves.length > 0);
  return layers.some((layer) =>
    layer.curves.some((curve) => layer.strokeOnly === true || !curve.closed),
  );
}

/** Half the widest stroke drawn on this page, in page units. */
function strokeAllowance(page: TracedSvgPage): number {
  const size = page.physicalSizeMm;
  if (size === undefined || !(page.pixelWidth > 0) || !(page.pixelHeight > 0)) return 0.5;
  const pixel = Math.max(size.widthMm / page.pixelWidth, size.heightMm / page.pixelHeight);
  return Math.max(pixel, TRACED_HAIRLINE_MM) / 2;
}
