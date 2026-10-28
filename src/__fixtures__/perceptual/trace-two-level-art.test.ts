// Two-level crops of the repo's real art (quality audit Q4-P2-1, ADR-530
// Amendment 11). Thresholded once (alpha over white, luma <= 128, Line Art's
// band) as the audit fed them to both tracers. Their thin detail takes the 2x
// route, whose cleanup still decides which marks exist; the outline is drawn
// on the source grid instead of following the enlargement's staircase.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ColoredPath, CurveSubpath, PathSegment, Vec2 } from '../../core/scene';
import { TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import type { RawImageData, TraceOptions } from '../../core/trace/trace-image';
import { decodePngFile } from './png-decode';

const ASSETS = join(__dirname, 'assets');
const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;

function twoLevelCrop(file: string, left: number, top: number, w: number, h: number): RawImageData {
  const image = decodePngFile(join(ASSETS, file));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = ((top + y) * image.width + left + x) * 4;
      const a = (image.data[i + 3] ?? 255) / 255;
      const over = (c: number): number => (image.data[i + c] ?? 255) * a + 255 * (1 - a);
      const ink = 0.299 * over(0) + 0.587 * over(1) + 0.114 * over(2) <= 128;
      const v = ink ? 0 : 255;
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}

function cubicAt(from: Vec2, segment: PathSegment, t: number): Vec2 {
  if (segment.kind !== 'cubic') return from;
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: a * from.x + b * segment.control1.x + c * segment.control2.x + d * segment.to.x,
    y: a * from.y + b * segment.control1.y + c * segment.control2.y + d * segment.to.y,
  };
}

// The closed outline resampled every 0.25 px of arc, and its length.
function resampled(curve: CurveSubpath): { readonly ring: Vec2[]; readonly length: number } {
  const dense: Vec2[] = [];
  let at = curve.start;
  for (const segment of curve.segments) {
    for (let k = 0; k < 16; k += 1) dense.push(cubicAt(at, segment, k / 16));
    at = segment.to;
  }
  const ring: Vec2[] = [];
  let walked = 0;
  let next = 0;
  for (let i = 0; i < dense.length; i += 1) {
    const p = dense[i] as Vec2;
    const q = dense[(i + 1) % dense.length] as Vec2;
    const span = Math.hypot(q.x - p.x, q.y - p.y);
    for (; next < walked + span; next += 0.25) {
      const t = (next - walked) / span;
      ring.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
    walked += span;
  }
  return { ring, length: walked };
}

function turnAt(ring: ReadonlyArray<Vec2>, i: number): number {
  const p = ring[(i + ring.length - 1) % ring.length] as Vec2;
  const q = ring[i] as Vec2;
  const r = ring[(i + 1) % ring.length] as Vec2;
  const turn = Math.atan2(r.y - q.y, r.x - q.x) - Math.atan2(q.y - p.y, q.x - p.x);
  return turn > Math.PI ? turn - 2 * Math.PI : turn < -Math.PI ? turn + 2 * Math.PI : turn;
}

// Changes of turning direction past 2 degrees of opposite turning.
function inflections(ring: ReadonlyArray<Vec2>): number {
  let sign = 0;
  let opposite = 0;
  let count = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const turn = turnAt(ring, i);
    if (Math.abs(turn) < 1e-6) continue;
    if (sign === 0) sign = Math.sign(turn);
    if (Math.sign(turn) === sign) {
      opposite = 0;
    } else if ((opposite += (Math.abs(turn) * 180) / Math.PI) > 2) {
      sign = -sign;
      opposite = 0;
      count += 1;
    }
  }
  return count;
}

// Inflections per 100 px of outline.
function inflectionsPer100Px(curves: ReadonlyArray<CurveSubpath>): number {
  let count = 0;
  let length = 0;
  for (const curve of curves) {
    const outline = resampled(curve);
    count += inflections(outline.ring);
    length += outline.length;
  }
  return (100 * count) / length;
}

function curvesOf(paths: ReadonlyArray<ColoredPath>): CurveSubpath[] {
  return paths.flatMap((path) => path.curves ?? []);
}

function segments(curves: ReadonlyArray<CurveSubpath>): number {
  return curves.reduce((sum, curve) => sum + curve.segments.length, 0);
}

describe('two-level real art is drawn without the enlargement staircase (Q4-P2-1)', () => {
  // Before: 928 segments and 19.6 inflections per 100 px; Potrace 1.16 159 and
  // 0.83; native-only Line Art keeps the same 11 rings.
  it('draws the filled Arch House lettering compactly', async () => {
    const image = twoLevelCrop('arch-house-filled-reference.png', 30, 730, 512, 260);
    const curves = curvesOf(await traceImageToColoredPaths(image, LINE_ART));
    expect(curves).toHaveLength(11);
    expect(segments(curves)).toBeLessThan(300);
    expect(inflectionsPer100Px(curves)).toBeLessThan(4);
  }, 60_000);

  // The 2x cleanup keeps the stress test's small marks (760 rings on main,
  // Potrace 772); tracing that source natively instead left 647. The floor
  // leaves the small-mark judge (ADR-434) free to keep more. Before: 14,517
  // segments and 21.9 inflections per 100 px.
  it('keeps every ring of the stress-test spiral the enlarged cleanup keeps', async () => {
    const image = twoLevelCrop('centerline-stress-test-20260909.png', 100, 560, 512, 512);
    const curves = curvesOf(await traceImageToColoredPaths(image, LINE_ART));
    expect(curves.length).toBeGreaterThanOrEqual(760);
    expect(segments(curves)).toBeLessThan(10_000);
    expect(inflectionsPer100Px(curves)).toBeLessThan(10);
  }, 120_000);
});
