// Centerline wobble probe (maintainer report 2026-07-16: "centerline is still
// tracing some wobbly lines, not 100% smooth on turns"). Traces ideal curved
// strokes — where the true centerline is known analytically — and MEASURES the
// deviation, then renders zoomed overlays for eyes. Gated like the other
// visual-audit harnesses: run with CENTERLINE_PROBE=1.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { Vec2 } from '../../core/scene';
import { traceImageToColoredPaths } from '../../core/trace';
import type { RawImageData, TraceOptions } from '../../core/trace/trace-image';
import { TRACE_PRESETS } from '../../core/trace/trace-presets';
import { paper, toRawImage, type Luma } from './procedural-ink';
import { renderTraceOverlay } from './render-overlay';

const OUT_DIR = join(process.cwd(), 'trace-audit-artifacts');
const RUN = process.env['CENTERLINE_PROBE'] === '1';
const CENTERLINE = TRACE_PRESETS['Centerline'] as TraceOptions;

// --- fixtures: ink a band around an analytic curve (smooth, no polygon bias) ---

function inkBandAroundCurve(
  l: Luma,
  curve: (t: number) => Vec2,
  samples: number,
  halfWidth: number,
): void {
  const pts: Vec2[] = [];
  for (let i = 0; i <= samples; i += 1) pts.push(curve(i / samples));
  for (let y = 0; y < l.h; y += 1) {
    for (let x = 0; x < l.w; x += 1) {
      const p = { x: x + 0.5, y: y + 0.5 };
      let best = Infinity;
      for (let i = 1; i < pts.length; i += 1) {
        const d = segDist(p, pts[i - 1] as Vec2, pts[i] as Vec2);
        if (d < best) best = d;
      }
      // 1px anti-aliased falloff like a real export.
      const t = Math.max(0, Math.min(1, halfWidth + 0.5 - best));
      const v = 255 * (1 - t);
      if (v < (l.px[y * l.w + x] ?? 255)) l.px[y * l.w + x] = v;
    }
  }
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function circleFixture(strokePx: number): {
  image: RawImageData;
  cx: number;
  cy: number;
  r: number;
} {
  const size = 240;
  const cx = size / 2;
  const cy = size / 2;
  const r = 80;
  const l = paper(size, size);
  inkBandAroundCurve(
    l,
    (t) => ({ x: cx + r * Math.cos(2 * Math.PI * t), y: cy + r * Math.sin(2 * Math.PI * t) }),
    720,
    strokePx / 2,
  );
  return { image: toRawImage(l), cx, cy, r };
}

// Classic parametric heart, scaled into the canvas — tight curvature at the
// lobes and a sharp point at the bottom, like the user's traced heart.
function heartFixture(strokePx: number): RawImageData {
  const size = 300;
  const l = paper(size, size);
  inkBandAroundCurve(
    l,
    (t) => {
      const a = 2 * Math.PI * t;
      const x = 16 * Math.sin(a) ** 3;
      const y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
      return { x: size / 2 + x * 7.5, y: size / 2 - y * 7.5 + 10 };
    },
    900,
    strokePx / 2,
  );
  return toRawImage(l);
}

// --- metrics ---

function resampleClosed(points: ReadonlyArray<Vec2>, step: number): Vec2[] {
  const ring = [...points];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first !== undefined && last !== undefined && (first.x !== last.x || first.y !== last.y)) {
    ring.push(first);
  }
  const out: Vec2[] = [];
  let carry = 0;
  for (let i = 1; i < ring.length; i += 1) {
    const a = ring[i - 1] as Vec2;
    const b = ring[i] as Vec2;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    let d = carry;
    while (d < len) {
      const t = d / len;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += step;
    }
    carry = d - len;
  }
  return out;
}

function circleDeviation(
  points: ReadonlyArray<Vec2>,
  cx: number,
  cy: number,
): {
  meanR: number;
  rms: number;
  max: number;
} {
  const rs = points.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const meanR = rs.reduce((s, r) => s + r, 0) / rs.length;
  const dev = rs.map((r) => r - meanR);
  const rms = Math.sqrt(dev.reduce((s, d) => s + d * d, 0) / dev.length);
  const max = Math.max(...dev.map((d) => Math.abs(d)));
  return { meanR, rms, max };
}

// Sum of |heading change of heading change| per uniform-arc vertex — zero for
// a perfect circle sampled uniformly, grows with every wiggle.
function bendingRoughness(points: ReadonlyArray<Vec2>): number {
  const headings: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Vec2;
    const b = points[i] as Vec2;
    headings.push(Math.atan2(b.y - a.y, b.x - a.x));
  }
  let sum = 0;
  for (let i = 2; i < headings.length; i += 1) {
    sum += Math.abs(
      angleDelta(
        angleDelta(headings[i] as number, headings[i - 1] as number),
        angleDelta(headings[i - 1] as number, headings[i - 2] as number),
      ),
    );
  }
  return sum;
}

function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// --- probe ---

it.skipIf(!RUN)(
  'measures centerline wobble on ideal curved strokes',
  async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const strokePx of [2, 4, 8]) {
      const fx = circleFixture(strokePx);
      const paths = await traceImageToColoredPaths(fx.image, CENTERLINE);
      const polylines = paths.flatMap((p) => p.polylines);
      const loop = polylines.reduce((a, b) => (b.points.length > a.points.length ? b : a));
      const uniform = resampleClosed(loop.points, 1);
      const dev = circleDeviation(uniform, fx.cx, fx.cy);
      const rough = bendingRoughness(uniform) / uniform.length;
      console.log(
        `circle stroke=${strokePx}px: loops=${polylines.length} verts=${loop.points.length} ` +
          `meanR=${dev.meanR.toFixed(2)} (ideal 80) rmsDev=${dev.rms.toFixed(3)}px ` +
          `maxDev=${dev.max.toFixed(3)}px roughness=${rough.toFixed(4)} rad/vertex`,
      );
      writeFileSync(
        join(OUT_DIR, `probe-circle-${strokePx}px__centerline.png`),
        renderTraceOverlay(fx.image, paths, 4),
      );
    }
    const heart = heartFixture(4);
    const heartPaths = await traceImageToColoredPaths(heart, CENTERLINE);
    const heartLoop = heartPaths
      .flatMap((p) => p.polylines)
      .reduce((a, b) => (b.points.length > a.points.length ? b : a));
    const uniformHeart = resampleClosed(heartLoop.points, 1);
    console.log(
      `heart stroke=4px: verts=${heartLoop.points.length} ` +
        `roughness=${(bendingRoughness(uniformHeart) / uniformHeart.length).toFixed(4)} rad/vertex`,
    );
    writeFileSync(
      join(OUT_DIR, 'probe-heart-4px__centerline.png'),
      renderTraceOverlay(heart, heartPaths, 3),
    );
  },
  120000,
);
