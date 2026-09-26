// Corner dial on MEASURED loops (ADR-404): an anti-aliased source's crack
// chain is the field's iso-line, which rounds every apex. The dial must still
// find the drawn apex (confirmed by the field, contour-corner-field.ts), must
// not invent one where the drawing is rounded, and must keep the inner corners
// of a star whose legs wrap round the neighbouring tips.

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { midCrackChainWithStats, traceBoundaryLoops } from './contour-boundary';
import { cornerThresholdFromSmoothness, decideContourCorners } from './contour-corners';
import type { CrackSubPixelField } from './saddle-connectivity';

type Inside = (x: number, y: number) => boolean;

// Box-filtered (anti-aliased) raster of a shape, thresholded at mid-grey.
function antiAliased(width: number, height: number, inside: Inside, threshold = 128) {
  const samples = 16;
  const luma = new Float64Array(width * height);
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          if (inside(x + (sx + 0.5) / samples, y + (sy + 0.5) / samples)) covered += 1;
        }
      }
      const value = Math.round(255 - (covered / samples ** 2) * 255);
      luma[y * width + x] = value;
      ink[y * width + x] = value < threshold ? 1 : 0;
    }
  }
  const field: CrackSubPixelField = {
    lumaAt: (x, y) =>
      x < 0 || y < 0 || x >= width || y >= height ? 255 : (luma[y * width + x] as number),
    thresholdAt: () => threshold,
  };
  return { ink, field };
}

// The pixel-centre bilinear enlargement auto-upscale.ts upscaleBy makes of
// the anti-aliased raster, thresholded at mid-grey.
function enlarged(width: number, height: number, inside: Inside, scale: number) {
  const source = antiAliased(width, height, inside).field;
  const clampTo = (v: number, n: number): number => Math.min(n - 1, Math.max(0, v));
  const at = (x: number, y: number): number => source.lumaAt(clampTo(x, width), clampTo(y, height));
  const w = width * scale;
  const h = height * scale;
  const luma = new Float64Array(w * h);
  const ink = new Uint8Array(w * h);
  for (let oy = 0; oy < h; oy += 1) {
    for (let ox = 0; ox < w; ox += 1) {
      const sx = (ox + 0.5) / scale - 0.5;
      const sy = (oy + 0.5) / scale - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const row = (y: number): number => at(x0, y) * (1 - fx) + at(x0 + 1, y) * fx;
      const value = Math.round(row(y0) * (1 - fy) + row(y0 + 1) * fy);
      luma[oy * w + ox] = value;
      ink[oy * w + ox] = value < 128 ? 1 : 0;
    }
  }
  const field: CrackSubPixelField = {
    lumaAt: (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 255 : (luma[y * w + x] as number)),
    thresholdAt: () => 128,
  };
  return { width: w, height: h, ink, field };
}

// Corner apexes (source px) the dial decides on every measured loop of the
// raster, traced at `scale` times the source's resolution.
function measuredCorners(
  width: number,
  height: number,
  inside: Inside,
  scale = 1,
  threshold = 128,
): Vec2[] {
  const { ink, field } =
    scale === 1
      ? antiAliased(width, height, inside, threshold)
      : enlarged(width, height, inside, scale);
  const apexes: Vec2[] = [];
  for (const loop of traceBoundaryLoops({ width: width * scale, height: height * scale, ink })) {
    const crack = midCrackChainWithStats(loop.points, field);
    expect(crack.interpolatedFraction).toBeGreaterThan(0.5);
    const corners = decideContourCorners({
      staircase: loop.points,
      cracks: crack.points,
      measured: true,
      pixelScale: scale,
      thresholdPx: cornerThresholdFromSmoothness(0.55),
      field,
    });
    apexes.push(...corners.map(({ apex }) => ({ x: apex.x / scale, y: apex.y / scale })));
  }
  return apexes;
}

function nearest(apexes: ReadonlyArray<Vec2>, p: Vec2): number {
  return Math.min(...apexes.map((a) => Math.hypot(a.x - p.x, a.y - p.y)));
}

const TIP = { x: 10.3, y: 30.2 };

// A wedge of `degrees` pointing left from `tip`, its tip optionally rounded by
// a fillet of radius r tangent to both edges.
function wedge(r: number, degrees = 30, tip: Vec2 = TIP): Inside {
  const half = (degrees * Math.PI) / 360;
  const centreX = tip.x + r / Math.sin(half);
  const tangentX = (r * Math.cos(half) ** 2) / Math.sin(half);
  return (x, y) => {
    const px = x - tip.x;
    const inWedge = px > 0 && px < 40 && Math.abs(y - tip.y) < px * Math.tan(half);
    return inWedge && (r === 0 || px >= tangentX || Math.hypot(x - centreX, y - tip.y) < r);
  };
}

function star(cx: number, cy: number, tips: number, outer: number, inner: number) {
  const points: Vec2[] = [];
  for (let i = 0; i < 2 * tips; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / tips;
    const radius = i % 2 === 0 ? outer : inner;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  const inside: Inside = (x, y) => {
    let within = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const p = points[i] as Vec2;
      const q = points[j] as Vec2;
      if (p.y > y !== q.y > y && x < ((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x) {
        within = !within;
      }
    }
    return within;
  };
  return { points, inside };
}

describe('decideContourCorners on measured (anti-aliased) loops', () => {
  it('finds the apex of an anti-aliased 30 degree wedge within 0.15 px', () => {
    // The iso-line recedes ~0.9 px from this tip: past the tight standoff, so
    // only the field's confirmation lets the apex stand.
    expect(nearest(measuredCorners(60, 60, wedge(0)), TIP)).toBeLessThan(0.15);
  });

  it('finds the same apex when the source is traced at 2x (auto-upscale)', () => {
    // The enlarged field is a bilinear blend of the source pixels, not their
    // box coverage; the field check must model that blend to confirm the tip.
    // (Reading one enlarged pixel per source pixel as its coverage dropped
    // these tips: no corner within 40 px.)
    for (const [degrees, tip] of [
      [30, { x: 10.7, y: 30.5 }],
      [40, { x: 10.7, y: 30.5 }],
      [60, { x: 10, y: 30 }],
    ] as const) {
      expect(nearest(measuredCorners(60, 60, wedge(0, degrees, tip), 2), tip)).toBeLessThan(0.15);
    }
  });

  it('keeps every corner of an anti-aliased rectangle thresholded off half coverage', () => {
    // Sharp and Smooth threshold by Otsu: 97 of 255 on this rectangle. The
    // iso-line then sits ~0.12 px inside every edge and the bottom-left corner
    // stood 0.704 px off its chain: the plain allowance dropped it (Smooth
    // traced three corners). The remaining error is that edge inset.
    const x0 = 37.3;
    const y0 = 23.6;
    const truth = [
      { x: x0, y: y0 },
      { x: x0 + 100, y: y0 },
      { x: x0 + 100, y: y0 + 60 },
      { x: x0, y: y0 + 60 },
    ];
    const inside: Inside = (x, y) => x > x0 && x < x0 + 100 && y > y0 && y < y0 + 60;
    const apexes = measuredCorners(200, 120, inside, 1, 97);
    for (const p of truth) expect(nearest(apexes, p)).toBeLessThan(0.4);
  });

  it('does not extrapolate a filleted tip to the sharp apex its legs meet at', () => {
    // Without the field check the 0.7 px fillet gets a corner 0.04 px from TIP.
    for (const r of [0.7, 1]) {
      expect(nearest(measuredCorners(60, 60, wedge(r)), TIP)).toBeGreaterThan(1);
    }
  });

  it('keeps every inner corner of an anti-aliased 12-point star', () => {
    // Each inner corner's legs run up the neighbouring tips' flanks; without
    // the measured leg-wrap trim two of them lose to those tips.
    const { points, inside } = star(70.4, 70.7, 12, 60, 36);
    const apexes = measuredCorners(142, 142, inside);
    const inner = points.filter((_, i) => i % 2 === 1);
    for (const p of inner) expect(nearest(apexes, p)).toBeLessThan(0.15);
  });
});
