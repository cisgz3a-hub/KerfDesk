// Perceptual test harness — polygon rasterizer.
//
// Turns pipeline geometry (ColoredPath[] / Polyline[]) back into a binary
// ink mask so a test can ask the only question that matters for trace
// fidelity: "do the traced contours cover the same pixels as the source
// image?" The existing trace tests only check structure (path counts,
// polyline lengths); none renders the output. This is the missing
// measuring instrument.
//
// Algorithm is the even-odd scanline fill already proven in
// src/core/job/fill-hatching.ts, specialised to emit filled pixel spans
// instead of hatch-line segments. Even-odd across a path's contours makes
// holes (letter "O", an annulus) come out empty, exactly as the laser
// fill does. Open polylines are drawn as 1-pixel strokes.
//
// Coordinate space: inputs are assumed to already be in pixel space (the
// imagetracerjs path emits coords in the source image's pixel grid at
// scale=1), so no transform is applied. Pixel (x, y) is ink iff its centre
// (x + 0.5, y + 0.5) lies inside an odd number of contours.
//
// Test-only helper: lives under src/__fixtures__ (boundary- and
// coverage-exempt per eslint.config.mjs). Pure and deterministic.

import type { ColoredPath, Polyline, Vec2 } from '../../core/scene';

export type Mask = {
  readonly width: number;
  readonly height: number;
  // Length width*height. 1 = ink, 0 = background. Row-major: index = y*width + x.
  readonly data: Uint8Array;
};

// Sub-pixel tolerance for the half-open scanline interval. Matches the
// intent of fill-hatching's SCANLINE_EPS — keep "vertex exactly on the
// scanline" off the boundary so spans don't double-count.
const SCANLINE_EPS = 1e-9;

export function createMask(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(Math.max(0, width * height)) };
}

// Rasterize every contour across every colour layer into one ink mask.
// Each path is filled independently (even-odd within its own contours) and
// OR-ed into the result, so a hole in one colour that another colour fills
// still reads as ink — the harness asks "inked by anything?", not "by what".
export function rasterizeColoredPaths(
  paths: ReadonlyArray<ColoredPath>,
  width: number,
  height: number,
): Mask {
  const mask = createMask(width, height);
  for (const path of paths) {
    orInto(mask, rasterizePolylines(path.polylines, width, height));
  }
  return mask;
}

export function rasterizePolylines(
  polylines: ReadonlyArray<Polyline>,
  width: number,
  height: number,
): Mask {
  const mask = createMask(width, height);
  const closed = polylines.filter((pl) => pl.closed && pl.points.length >= 3);
  const open = polylines.filter((pl) => !pl.closed || pl.points.length < 3);
  fillClosed(mask, closed);
  for (const pl of open) strokeOpen(mask, pl);
  return mask;
}

// Even-odd scanline fill over the combined edge set of all closed contours.
// One horizontal scan per pixel row, sampled at the row centre (y + 0.5).
function fillClosed(mask: Mask, closed: ReadonlyArray<Polyline>): void {
  if (closed.length === 0) return;
  for (let y = 0; y < mask.height; y += 1) {
    const scanY = y + 0.5;
    const xs = collectIntersectionsAtY(closed, scanY);
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = xs[i];
      const xb = xs[i + 1];
      if (xa === undefined || xb === undefined) continue;
      fillSpan(mask, y, xa, xb);
    }
  }
}

// Set every pixel in row y whose centre (x + 0.5) lies in [xa, xb).
function fillSpan(mask: Mask, y: number, xa: number, xb: number): void {
  const xStart = Math.max(0, Math.ceil(xa - 0.5));
  const xEnd = Math.min(mask.width - 1, Math.ceil(xb - 0.5) - 1);
  const rowBase = y * mask.width;
  for (let x = xStart; x <= xEnd; x += 1) {
    mask.data[rowBase + x] = 1;
  }
}

// For one scanline Y, collect the X of every edge crossing it. Half-open
// rule [yLo, yHi) avoids double-counting a vertex shared by two edges.
function collectIntersectionsAtY(polylines: ReadonlyArray<Polyline>, y: number): number[] {
  const out: number[] = [];
  for (const pl of polylines) {
    const n = pl.points.length;
    for (let i = 0; i < n; i += 1) {
      const a = pl.points[i];
      const b = pl.points[(i + 1) % n];
      if (a === undefined || b === undefined) continue;
      const yLo = Math.min(a.y, b.y);
      const yHi = Math.max(a.y, b.y);
      if (y < yLo || y >= yHi) continue;
      const dy = b.y - a.y;
      if (Math.abs(dy) < SCANLINE_EPS) continue;
      const t = (y - a.y) / dy;
      out.push(a.x + t * (b.x - a.x));
    }
  }
  return out;
}

// Draw a 1-pixel stroke along an open polyline (consecutive points only,
// no implicit closing edge). DDA line stepping — one pixel per max-axis step.
function strokeOpen(mask: Mask, pl: Polyline): void {
  for (let i = 0; i + 1 < pl.points.length; i += 1) {
    const a = pl.points[i];
    const b = pl.points[i + 1];
    if (a === undefined || b === undefined) continue;
    drawLine(mask, a, b);
  }
}

function drawLine(mask: Mask, a: Vec2, b: Vec2): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    setPixel(mask, Math.round(a.x + dx * t), Math.round(a.y + dy * t));
  }
}

function setPixel(mask: Mask, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return;
  mask.data[y * mask.width + x] = 1;
}

function orInto(target: Mask, src: Mask): void {
  const n = Math.min(target.data.length, src.data.length);
  for (let i = 0; i < n; i += 1) {
    if (src.data[i] === 1) target.data[i] = 1;
  }
}
