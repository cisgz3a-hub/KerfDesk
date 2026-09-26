// Pen width of a traced centreline stroke (ADR-454). The distance field knows
// the inscribed radius at every ink pixel, but its integer-pixel sampling
// cannot tell a 2 px line from a 1 px one. Measuring straight across instead
// — walking the local normal both ways until the ink ends — resolves every
// width to a quarter pixel.

import type { Vec2 } from '../../scene';
import type { InkMask } from '../centerline/distance-field';

const MARCH_STEP_PX = 0.25;
/** A stroke whose width spread (p10..p90) stays under this fraction of its
 *  median width is a constant-width pen line and carries its width. */
export const CONSTANT_WIDTH_SPREAD = 0.25;
const MIN_WIDTH_SAMPLES = 3;

export type StrokeWidthProfile = {
  readonly medianPx: number;
  readonly spreadPx: number;
};

/** Widths across the stroke at its samples, or null when too short to say. */
export function strokeWidthProfile(
  points: ReadonlyArray<Vec2>,
  mask: InkMask,
  maxWidthPx: number,
): StrokeWidthProfile | null {
  const widths: number[] = [];
  const limit = maxWidthPx * 2 + 2;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const normal = normalAt(points, i);
    if (p === undefined || normal === null) continue;
    const width = march(mask, p, normal, limit) + march(mask, p, negate(normal), limit);
    if (width > 0) widths.push(width);
  }
  if (widths.length < MIN_WIDTH_SAMPLES) return null;
  widths.sort((a, b) => a - b);
  const at = (q: number): number => widths[Math.min(widths.length - 1, Math.floor(q * widths.length))] ?? 0;
  return { medianPx: at(0.5), spreadPx: at(0.9) - at(0.1) };
}

/** The pen width a near-constant stroke carries, else undefined. */
export function constantStrokeWidthPx(profile: StrokeWidthProfile | null): number | undefined {
  if (profile === null || !(profile.medianPx > 0)) return undefined;
  return profile.spreadPx < CONSTANT_WIDTH_SPREAD * profile.medianPx ? profile.medianPx : undefined;
}

function normalAt(points: ReadonlyArray<Vec2>, i: number): Vec2 | null {
  const a = points[Math.max(0, i - 1)];
  const b = points[Math.min(points.length - 1, i + 1)];
  if (a === undefined || b === undefined) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  return length < 1e-9 ? null : { x: -dy / length, y: dx / length };
}

// Distance from p along dir to the first paper pixel, in MARCH_STEP_PX steps.
function march(mask: InkMask, p: Vec2, dir: Vec2, limit: number): number {
  let travelled = 0;
  while (travelled < limit) {
    const next = travelled + MARCH_STEP_PX;
    if (!isInk(mask, p.x + dir.x * next, p.y + dir.y * next)) return travelled + MARCH_STEP_PX / 2;
    travelled = next;
  }
  return travelled;
}

function isInk(mask: InkMask, x: number, y: number): boolean {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) return false;
  return mask.ink[py * mask.width + px] === 1;
}

function negate(v: Vec2): Vec2 {
  return { x: -v.x, y: -v.y };
}
