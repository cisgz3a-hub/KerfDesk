// Perceptual test harness - toolpath burn rasterizer.
//
// Converts preview/emitted burn paths back into a binary mask so tests can
// compare "what the job will burn" against an independent source mask. Travel
// moves are ignored by design; only cut/burn steps contribute ink.

import type { Toolpath } from '../../core/job';
import type { Vec2 } from '../../core/scene';
import { createMask, type Mask } from './rasterize';

export type ToolpathRasterizeOptions = {
  readonly burnWidthMm?: number;
};

const DEFAULT_BURN_WIDTH_MM = 1;

export function rasterizeToolpathBurn(
  toolpath: Toolpath,
  width: number,
  height: number,
  options: ToolpathRasterizeOptions = {},
): Mask {
  const mask = createMask(width, height);
  for (const step of toolpath.steps) {
    if (step.kind !== 'cut') continue;
    for (let i = 1; i < step.polyline.length; i += 1) {
      const a = step.polyline[i - 1];
      const b = step.polyline[i];
      if (a === undefined || b === undefined) continue;
      rasterizeBurnSegment(mask, a, b, options.burnWidthMm ?? DEFAULT_BURN_WIDTH_MM);
    }
  }
  return mask;
}

export function rasterizeBurnSegment(mask: Mask, a: Vec2, b: Vec2, burnWidthMm: number): void {
  const halfWidth = Math.max(0, burnWidthMm) / 2;
  const bounds = segmentPixelBounds(mask, a, b, halfWidth);
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const center = { x: x + 0.5, y: y + 0.5 };
      if (distanceToSegment(center, a, b) <= halfWidth) {
        mask.data[y * mask.width + x] = 1;
      }
    }
  }
}

function segmentPixelBounds(
  mask: Mask,
  a: Vec2,
  b: Vec2,
  halfWidth: number,
): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} {
  return {
    minX: clampPixel(Math.floor(Math.min(a.x, b.x) - halfWidth), mask.width),
    minY: clampPixel(Math.floor(Math.min(a.y, b.y) - halfWidth), mask.height),
    maxX: clampPixel(Math.ceil(Math.max(a.x, b.x) + halfWidth), mask.width),
    maxY: clampPixel(Math.ceil(Math.max(a.y, b.y) + halfWidth), mask.height),
  };
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  const closest = { x: a.x + t * dx, y: a.y + t * dy };
  return Math.hypot(p.x - closest.x, p.y - closest.y);
}

function clampPixel(value: number, size: number): number {
  return Math.max(0, Math.min(Math.max(0, size - 1), value));
}
