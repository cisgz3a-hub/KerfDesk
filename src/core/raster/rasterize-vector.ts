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
// A1 scope: Fill All only — even-odd fill of closed contours, holes correct.
// Outlines and Use-Cut-Settings render types arrive in A3/A4; a render-type
// parameter is deliberately omitted until then rather than stubbed.
//
// Pure-core: no DOM/canvas/clock/random. PNG encoding and RasterImage
// assembly are the UI's job (ADR-029 §4) — this stops at the luma grid.
//
// The even-odd scanline fill mirrors the algorithm in
// src/core/job/fill-hatching.ts and src/__fixtures__/perceptual/rasterize.ts.
// It is duplicated rather than shared because those emit hatch segments / a
// binary mask (not luma) and the fixture is test-only; extracting a shared
// scanline primitive across all three is a candidate refactor, not done here.

import type { Bounds, Polyline, Vec2 } from '../scene';

// LightBurn sets every converted pixel to 50% gray; white is unburned material.
const INK_LUMA = 128;
const BACKGROUND_LUMA = 255;
const MM_PER_INCH = 25.4;
// Keep "vertex exactly on the scanline" off the half-open span boundary so
// adjacent spans don't double-count (matches fill-hatching's SCANLINE_EPS).
const SCANLINE_EPS = 1e-9;
const MIN_CONTOUR_POINTS = 3;
const MIN_PIXEL_DIM = 1;

export type VectorRasterInput = {
  // Closed contours in millimetre (scene) space. Even-odd across all
  // contours, so an inner contour cuts a hole (the centre of a letter "O").
  readonly polylines: ReadonlyArray<Polyline>;
  // The mm-space axis-aligned footprint the output bitmap spans.
  readonly bounds: Bounds;
  // Target pixel density; pixel dimensions derive from bounds × dpi.
  readonly dpi: number;
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
  const { polylines, bounds, dpi } = input;
  const pxPerMm = Math.max(0, dpi) / MM_PER_INCH;
  const width = pixelExtent(bounds.maxX - bounds.minX, pxPerMm);
  const height = pixelExtent(bounds.maxY - bounds.minY, pxPerMm);
  const luma = new Uint8Array(width * height).fill(BACKGROUND_LUMA);
  fillEvenOdd(luma, width, height, toPixelContours(polylines, bounds, pxPerMm));
  return { luma, width, height };
}

function pixelExtent(mm: number, pxPerMm: number): number {
  return Math.max(MIN_PIXEL_DIM, Math.round(mm * pxPerMm));
}

// Map closed mm-space contours into pixel space; drop open / degenerate ones.
function toPixelContours(
  polylines: ReadonlyArray<Polyline>,
  bounds: Bounds,
  pxPerMm: number,
): Vec2[][] {
  const out: Vec2[][] = [];
  for (const pl of polylines) {
    if (!pl.closed || pl.points.length < MIN_CONTOUR_POINTS) continue;
    out.push(
      pl.points.map((p) => ({
        x: (p.x - bounds.minX) * pxPerMm,
        y: (p.y - bounds.minY) * pxPerMm,
      })),
    );
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
