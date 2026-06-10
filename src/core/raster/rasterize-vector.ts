// Phase F.4 Convert to Bitmap (ADR-029) — pure-core vector → raster.
//
// Rasterizes closed vector contours (in millimetre / scene space) into a
// grayscale luma buffer sized by a target DPI — the engrave-source bitmap
// LightBurn's "Convert to Bitmap" produces. Inked area renders at 50% gray
// (LightBurn sets every converted pixel to mid-gray) on a white (unburned)
// ground. The output uses the same luma convention dither() consumes — high
// luma = light = less burn — so a converted bitmap flows straight through the
// F.2 engrave path with no special-casing.
//
// Render types mirror LightBurn's Convert to Bitmap dialog:
// - Fill All: even-odd fill of closed contours, holes correct.
// - Outlines: rasterize vector strokes, including open polylines.
// Use Cut Settings is resolved by the UI layer into fill/outline groups because
// it depends on scene layer modes, not pure geometry.
//
// Pure-core: no DOM/canvas/clock/random. PNG encoding and RasterImage
// assembly are the UI's job (ADR-029 §4) — this stops at the luma grid.
//
// The even-odd scanline fill mirrors the algorithm in
// src/core/job/fill-hatching.ts and src/__fixtures__/perceptual/rasterize.ts.
// It is duplicated rather than shared because those emit hatch segments / a
// binary mask (not luma) and the fixture is test-only; extracting a shared
// scanline primitive across all three is a candidate refactor, not done here.

import { isClosedEnough, type Bounds, type Polyline, type Vec2 } from '../scene';

// LightBurn sets every converted pixel to 50% gray; white is unburned
// material. 127, not 128: ditherThreshold burns strictly BELOW its cutoff
// (default 128), so exactly-128 ink composed to zero output — a converted
// bitmap on a Threshold layer silently dithered to all-zero S (M7,
// AUDIT-2026-06-10). 127 keeps the 50%-gray intent within rounding and
// stays on the burning side of the default cutoff.
const INK_LUMA = 127;
const BACKGROUND_LUMA = 255;
const MM_PER_INCH = 25.4;
// Keep "vertex exactly on the scanline" off the half-open span boundary so
// adjacent spans don't double-count (matches fill-hatching's SCANLINE_EPS).
const SCANLINE_EPS = 1e-9;
const OUTLINE_RADIUS_PX = 0.5;
const OUTLINE_RADIUS_SQ = OUTLINE_RADIUS_PX * OUTLINE_RADIUS_PX;
const MIN_CONTOUR_POINTS = 3;
const MIN_STROKE_POINTS = 2;
const MIN_PIXEL_DIM = 1;

export type VectorRasterRenderType = 'fill-all' | 'outlines';

export type VectorRasterInput = {
  // Closed contours in millimetre (scene) space. Even-odd across all
  // contours, so an inner contour cuts a hole (the centre of a letter "O").
  readonly polylines: ReadonlyArray<Polyline>;
  readonly renderType?: VectorRasterRenderType;
  // Explicit groups used by Convert to Bitmap's "Use Cut Settings" mode. When
  // omitted, `renderType` determines whether `polylines` are filled or stroked.
  readonly fillPolylines?: ReadonlyArray<Polyline>;
  readonly outlinePolylines?: ReadonlyArray<Polyline>;
  // The mm-space axis-aligned footprint the output bitmap spans.
  readonly bounds: Bounds;
  // Target pixel density. Most callers use dpi; Convert to Bitmap can pass
  // exact dimensions after applying its raster budget and object transform.
  readonly dpi?: number;
  readonly pixelWidth?: number;
  readonly pixelHeight?: number;
};

export type VectorRaster = {
  // Row-major, length width*height. High = light = less burn (dither convention).
  readonly luma: Uint8Array;
  readonly width: number;
  readonly height: number;
};

// Fill All: rasterize closed contours into a grayscale luma grid. Open or
// fewer-than-3-point contours contribute nothing (LightBurn fills only closed
// shapes). Degenerate input (no area / non-positive dpi) degrades to a 1×1
// white pixel rather than throwing.
export function rasterizeVectorToLuma(input: VectorRasterInput): VectorRaster {
  const { polylines, bounds } = input;
  const widthMm = bounds.maxX - bounds.minX;
  const heightMm = bounds.maxY - bounds.minY;
  const { width, height } = rasterDimensions(input, widthMm, heightMm);
  const luma = new Uint8Array(width * height).fill(BACKGROUND_LUMA);
  const fillPolylines = input.fillPolylines ?? (input.renderType === 'outlines' ? [] : polylines);
  const outlinePolylines =
    input.outlinePolylines ?? (input.renderType === 'outlines' ? polylines : []);
  fillEvenOdd(
    luma,
    width,
    height,
    toPixelContours(
      fillPolylines,
      bounds,
      scaleForExtent(width, widthMm),
      scaleForExtent(height, heightMm),
    ),
  );
  strokePolylines(
    luma,
    width,
    height,
    toPixelStrokes(
      outlinePolylines,
      bounds,
      scaleForExtent(width, widthMm),
      scaleForExtent(height, heightMm),
    ),
  );
  return { luma, width, height };
}

function pixelExtent(mm: number, pxPerMm: number): number {
  return Math.max(MIN_PIXEL_DIM, Math.round(mm * pxPerMm));
}

function rasterDimensions(
  input: VectorRasterInput,
  widthMm: number,
  heightMm: number,
): { readonly width: number; readonly height: number } {
  if (input.pixelWidth !== undefined && input.pixelHeight !== undefined) {
    return {
      width: Math.max(MIN_PIXEL_DIM, Math.floor(input.pixelWidth)),
      height: Math.max(MIN_PIXEL_DIM, Math.floor(input.pixelHeight)),
    };
  }
  const pxPerMm = Math.max(0, input.dpi ?? 0) / MM_PER_INCH;
  return {
    width: pixelExtent(widthMm, pxPerMm),
    height: pixelExtent(heightMm, pxPerMm),
  };
}

function scaleForExtent(pixelExtentPx: number, mm: number): number {
  return mm > 0 ? pixelExtentPx / mm : 0;
}

// Map closed mm-space contours into pixel space; drop open / degenerate
// ones. isClosedEnough (shared with fill-hatching, M4) accepts contours
// whose endpoints coincide without the closed flag — the same data-at-rest
// shape Fill was patched for, so Fill and Convert to Bitmap agree.
function toPixelContours(
  polylines: ReadonlyArray<Polyline>,
  bounds: Bounds,
  pxPerMmX: number,
  pxPerMmY: number,
): Vec2[][] {
  const out: Vec2[][] = [];
  for (const pl of polylines) {
    if (!isClosedEnough(pl) || pl.points.length < MIN_CONTOUR_POINTS) continue;
    out.push(
      pl.points.map((p) => ({
        x: (p.x - bounds.minX) * pxPerMmX,
        y: (p.y - bounds.minY) * pxPerMmY,
      })),
    );
  }
  return out;
}

type PixelStroke = {
  readonly closed: boolean;
  readonly points: ReadonlyArray<Vec2>;
};

function toPixelStrokes(
  polylines: ReadonlyArray<Polyline>,
  bounds: Bounds,
  pxPerMmX: number,
  pxPerMmY: number,
): PixelStroke[] {
  const out: PixelStroke[] = [];
  for (const pl of polylines) {
    if (pl.points.length < MIN_STROKE_POINTS) continue;
    out.push({
      closed: pl.closed,
      points: pl.points.map((p) => ({
        x: (p.x - bounds.minX) * pxPerMmX,
        y: (p.y - bounds.minY) * pxPerMmY,
      })),
    });
  }
  return out;
}

// One half-open scanline per pixel row, sampled at the row centre (y + 0.5).
function fillEvenOdd(
  luma: Uint8Array,
  width: number,
  height: number,
  contours: ReadonlyArray<ReadonlyArray<Vec2>>,
): void {
  if (contours.length === 0) return;
  for (let y = 0; y < height; y += 1) {
    const xs = crossingsAtY(contours, y + 0.5);
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = xs[i];
      const xb = xs[i + 1];
      if (xa === undefined || xb === undefined) continue;
      fillSpan(luma, width, y, xa, xb);
    }
  }
}

// Every edge crossing the scanline contributes its X. Half-open rule
// [yLo, yHi) counts a vertex shared by two edges exactly once.
function crossingsAtY(contours: ReadonlyArray<ReadonlyArray<Vec2>>, y: number): number[] {
  const out: number[] = [];
  for (const pts of contours) {
    const n = pts.length;
    for (let i = 0; i < n; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (a === undefined || b === undefined) continue;
      if (y < Math.min(a.y, b.y) || y >= Math.max(a.y, b.y)) continue;
      const dy = b.y - a.y;
      if (Math.abs(dy) < SCANLINE_EPS) continue;
      out.push(a.x + ((y - a.y) / dy) * (b.x - a.x));
    }
  }
  return out;
}

// Ink every pixel in row y whose centre (x + 0.5) lies in [xa, xb).
function fillSpan(luma: Uint8Array, width: number, y: number, xa: number, xb: number): void {
  const xStart = Math.max(0, Math.ceil(xa - 0.5));
  const xEnd = Math.min(width - 1, Math.ceil(xb - 0.5) - 1);
  const rowBase = y * width;
  for (let x = xStart; x <= xEnd; x += 1) {
    luma[rowBase + x] = INK_LUMA;
  }
}

function strokePolylines(
  luma: Uint8Array,
  width: number,
  height: number,
  strokes: ReadonlyArray<PixelStroke>,
): void {
  for (const stroke of strokes) {
    const { points } = stroke;
    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (a !== undefined && b !== undefined) strokeSegment(luma, width, height, a, b);
    }
    const first = points[0];
    const last = points[points.length - 1];
    if (stroke.closed && first !== undefined && last !== undefined) {
      strokeSegment(luma, width, height, last, first);
    }
  }
}

function strokeSegment(luma: Uint8Array, width: number, height: number, a: Vec2, b: Vec2): void {
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - OUTLINE_RADIUS_PX));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + OUTLINE_RADIUS_PX));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - OUTLINE_RADIUS_PX));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + OUTLINE_RADIUS_PX));
  for (let y = minY; y <= maxY; y += 1) {
    const rowBase = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      if (pointSegmentDistanceSq(x + 0.5, y + 0.5, a, b) <= OUTLINE_RADIUS_SQ) {
        luma[rowBase + x] = INK_LUMA;
      }
    }
  }
}

function pointSegmentDistanceSq(px: number, py: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= SCANLINE_EPS) {
    const pxDx = px - a.x;
    const pyDy = py - a.y;
    return pxDx * pxDx + pyDy * pyDy;
  }
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
  const qx = a.x + t * dx;
  const qy = a.y + t * dy;
  const qdx = px - qx;
  const qdy = py - qy;
  return qdx * qdx + qdy * qdy;
}
