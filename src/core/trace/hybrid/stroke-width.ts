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
const SAMPLE_STEP_PX = 0.5;
const WINDOW_PX = 6;

export type StrokeWidthProfile = {
  readonly medianPx: number;
  readonly spreadPx: number;
};

/** Widths across the stroke, or null when it is too short to say. Widths are
 *  measured every half pixel, then averaged over a few-pixel window: a
 *  diagonal hairline's staircase makes single cross-sections swing by a pixel
 *  even when the pen width never changed. */
export function strokeWidthProfile(
  points: ReadonlyArray<Vec2>,
  mask: InkMask,
  maxWidthPx: number,
): StrokeWidthProfile | null {
  const samples = resample(points, SAMPLE_STEP_PX);
  const limit = maxWidthPx * 2 + 2;
  const widths: number[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    const p = samples[i];
    const normal = normalAt(samples, i);
    if (p === undefined || normal === null) continue;
    widths.push(march(mask, p, normal, limit) + march(mask, p, negate(normal), limit));
  }
  const window = Math.max(1, Math.round(WINDOW_PX / SAMPLE_STEP_PX));
  if (widths.length < window) return null;
  const means: number[] = [];
  let sum = 0;
  for (let i = 0; i < widths.length; i += 1) {
    sum += widths[i] ?? 0;
    if (i >= window) sum -= widths[i - window] ?? 0;
    if (i >= window - 1) means.push(sum / window);
  }
  means.sort((a, b) => a - b);
  const at = (q: number): number =>
    means[Math.min(means.length - 1, Math.floor(q * means.length))] ?? 0;
  return { medianPx: at(0.5), spreadPx: at(0.9) - at(0.1) };
}

function resample(points: ReadonlyArray<Vec2>, step: number): Vec2[] {
  const out: Vec2[] = [];
  let carry = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    let at = carry;
    while (at < length) {
      const t = at / length;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      at += step;
    }
    carry = at - length;
  }
  return out;
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
