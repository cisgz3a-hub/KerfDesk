// Stroke rasterization for the Image Studio paint tools (ADR-242).
//
// The pointer path is resampled into brush stamps at a fixed fraction of the
// brush diameter (the classic stamping pipeline), accumulated in a
// stroke-local coverage window (MAX blend — see brush-stamp.ts), then
// composited once into the working buffer at the stroke's opacity. Painting
// white IS the eraser: white neither burns nor traces, so no separate erase
// op exists. The line tool is a two-point stroke; Shift's 45° constraint is
// the pure `snapLineEnd45` here so UI and tests share one definition.

import {
  type BrushParams,
  clampBrushDiameter,
  createCoverageWindow,
  stampInto,
} from './brush-stamp';
import { RGBA_CHANNELS, type RgbaBuffer } from './rgba-buffer';
import type { PixelRect } from './tiles';

// Quarter-diameter spacing keeps rounded stamp chains visually continuous
// without quadratic stamp counts on long strokes.
export const STROKE_SPACING_FRACTION = 0.25;

export type PaintColor = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
};

export type PaintPoint = {
  readonly x: number;
  readonly y: number;
};

export type PaintStroke = {
  readonly points: readonly PaintPoint[];
  readonly brush: BrushParams;
  readonly color: PaintColor;
};

/**
 * The document-space rect a stroke can touch — capture history tiles for this
 * BEFORE calling paintStrokeInPlace. Empty (zero-size) for an empty stroke.
 */
export function strokeDirtyRect(stroke: PaintStroke, buffer: RgbaBuffer): PixelRect {
  const first = stroke.points[0];
  if (first === undefined) return { x: 0, y: 0, width: 0, height: 0 };
  const radius = clampBrushDiameter(stroke.brush.diameterPx) / 2;
  let minX = first.x;
  let maxX = first.x;
  let minY = first.y;
  let maxY = first.y;
  for (const point of stroke.points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const left = Math.max(0, Math.floor(minX - radius) - 1);
  const top = Math.max(0, Math.floor(minY - radius) - 1);
  const right = Math.min(buffer.width, Math.ceil(maxX + radius) + 1);
  const bottom = Math.min(buffer.height, Math.ceil(maxY + radius) + 1);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function stampCentres(stroke: PaintStroke): readonly PaintPoint[] {
  const spacing = Math.max(
    1,
    clampBrushDiameter(stroke.brush.diameterPx) * STROKE_SPACING_FRACTION,
  );
  const centres: PaintPoint[] = [];
  let previous: PaintPoint | undefined;
  let carried = 0;
  for (const point of stroke.points) {
    if (previous === undefined) {
      centres.push(point);
      previous = point;
      continue;
    }
    const segment = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (segment === 0) continue;
    let distance = spacing - carried;
    while (distance <= segment) {
      const t = distance / segment;
      centres.push({
        x: previous.x + (point.x - previous.x) * t,
        y: previous.y + (point.y - previous.y) * t,
      });
      distance += spacing;
    }
    carried = segment - (distance - spacing);
    previous = point;
  }
  const last = stroke.points[stroke.points.length - 1];
  const tail = centres[centres.length - 1];
  if (last !== undefined && (tail === undefined || tail.x !== last.x || tail.y !== last.y)) {
    centres.push(last);
  }
  return centres;
}

/**
 * Rasterize the stroke into the buffer (mutates pixels in place) and return
 * the dirty rect it wrote inside. Alpha stays opaque — the document has no
 * transparency; "erasing" paints white.
 */
export function paintStrokeInPlace(buffer: RgbaBuffer, stroke: PaintStroke): PixelRect {
  const rect = strokeDirtyRect(stroke, buffer);
  if (rect.width === 0 || rect.height === 0) return rect;
  const window = createCoverageWindow(rect.x, rect.y, rect.width, rect.height);
  for (const centre of stampCentres(stroke)) {
    stampInto(window, centre.x, centre.y, stroke.brush);
  }
  const opacity = Math.min(1, Math.max(0, stroke.brush.opacity));
  for (let row = 0; row < rect.height; row += 1) {
    for (let col = 0; col < rect.width; col += 1) {
      const alpha = (window.alpha[row * rect.width + col] ?? 0) * opacity;
      if (alpha <= 0) continue;
      const base = ((rect.y + row) * buffer.width + rect.x + col) * RGBA_CHANNELS;
      blendChannel(buffer, base, stroke.color.r, alpha);
      blendChannel(buffer, base + 1, stroke.color.g, alpha);
      blendChannel(buffer, base + 2, stroke.color.b, alpha);
      buffer.data[base + 3] = 255;
    }
  }
  return rect;
}

function blendChannel(buffer: RgbaBuffer, index: number, target: number, alpha: number): void {
  const current = buffer.data[index] ?? 0;
  buffer.data[index] = Math.round(target * alpha + current * (1 - alpha));
}

/**
 * Constrain a line end to the nearest 45° direction from its start
 * (Shift-drag on the Line tool). Zero-length input returns the end unchanged.
 */
export function snapLineEnd45(from: PaintPoint, to: PaintPoint): PaintPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return to;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}
