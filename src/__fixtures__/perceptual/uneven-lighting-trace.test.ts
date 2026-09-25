// Uneven-lighting regression bar (ADR-394). Smooth, Sharp and Centerline
// binarize with an automatic Otsu cut; a single global cut cannot separate
// dark ink from paper whose own brightness spans the ink/paper gap. On the
// base these fixtures traced the dark part of the page as one blob (IoU
// 0.05-0.08). Background flattening must restore the ink, keep each solid
// shape a single loop, and leave uniform pages on the exact historical path.

import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import type { RawImageData } from '../../core/trace';
import { otsuBinarization } from '../../core/trace/background-flatten';
import { CENTERLINE_TRUTH_FIXTURES } from './centerline-truth';
import { compareMasks } from './compare';
import { createMask, rasterizeColoredPaths, rasterizePolylines, type Mask } from './rasterize';
import { PERCEPTUAL_FIXTURES } from './shapes';
import { filledStarImage } from './star-fixture';
import {
  HOLLOW_LOGO_TRACE_FIXTURE,
  LOGO_LIKE_TRACE_FIXTURE,
  SKETCH_CONTRAST_TRACE_FIXTURE,
} from './trace-fixtures';

const W = 400;
const H = 200;
const INK_LUMA = 60;

type Rect = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
// 200×5 bar, 5×90 bar, 20×20 square: true ink area 1,850 px².
const H_BAR: Rect = { x0: 20, y0: 10, x1: 220, y1: 15 };
const V_BAR: Rect = { x0: 30, y0: 40, x1: 35, y1: 130 };
const SQUARE: Rect = { x0: 200, y0: 100, x1: 220, y1: 120 };
const SHAPES = [H_BAR, V_BAR, SQUARE];

const inside = (r: Rect, x: number, y: number): boolean =>
  x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

const BACKGROUNDS: Readonly<Record<string, (x: number, y: number) => number>> = {
  // Linear left-to-right ramp, 150 → 250.
  'linear ramp': (x) => 150 + (100 * x) / (W - 1),
  // Radial vignette: 250 at the centre falling to 140 in the corners.
  'radial vignette': (x, y) => {
    const r = Math.hypot(x - W / 2, y - H / 2) / Math.hypot(W / 2, H / 2);
    return 250 - 110 * r * r;
  },
  // Lamp at the top-right corner: 255 there, 140 at the far corner.
  'bright corner': (x, y) => 140 + 115 * (1 - Math.hypot(x - W, y) / Math.hypot(W, H)),
};

function page(background: (x: number, y: number) => number): { image: RawImageData; truth: Mask } {
  const data = new Uint8ClampedArray(W * H * 4);
  const truth = createMask(W, H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const ink = SHAPES.some((r) => inside(r, x, y));
      const v = ink ? INK_LUMA : Math.round(background(x, y));
      const o = (y * W + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
      if (ink) truth.data[y * W + x] = 1;
    }
  }
  return { image: { width: W, height: H, data }, truth };
}

// Centerline scoring. Precision: traced stroke pixels lying on (or within
// 1px of) ink. Recall: each bar's midline covered within 2px, with the
// half-width trimmed from each end where a skeleton legitimately stops.
function nearAny(mask: Mask, x: number, y: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= mask.width || ny >= mask.height) continue;
      if (mask.data[ny * mask.width + nx] === 1) return true;
    }
  }
  return false;
}

function centerlineScores(traced: Mask, truth: Mask): { precision: number; recall: number } {
  let tracedPx = 0;
  let onInk = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (traced.data[y * W + x] !== 1) continue;
      tracedPx += 1;
      if (nearAny(truth, x, y, 1)) onInk += 1;
    }
  }
  const midline: Array<[number, number]> = [];
  for (let x = H_BAR.x0 + 3; x < H_BAR.x1 - 3; x += 1) midline.push([x, 12]);
  for (let y = V_BAR.y0 + 3; y < V_BAR.y1 - 3; y += 1) midline.push([32, y]);
  const covered = midline.filter(([x, y]) => nearAny(traced, x, y, 2)).length;
  return { precision: tracedPx === 0 ? 0 : onInk / tracedPx, recall: covered / midline.length };
}

describe('automatic Otsu traces survive uneven lighting', () => {
  for (const [name, background] of Object.entries(BACKGROUNDS)) {
    for (const preset of ['Smooth', 'Sharp'] as const) {
      it(`${name}: ${preset} keeps each shape one loop at IoU ≥ 0.9`, async () => {
        const { image, truth } = page(background);
        const paths = await traceImageToColoredPaths(image, TRACE_PRESETS[preset]!);
        const metrics = compareMasks(rasterizeColoredPaths(paths, W, H), truth);
        const loops = paths.flatMap((p) => p.polylines).filter((pl) => pl.closed);
        console.log(`[uneven-lighting] ${name} ${preset} IoU ${metrics.iou.toFixed(3)}`);
        expect(metrics.iou).toBeGreaterThanOrEqual(0.9);
        expect(loops).toHaveLength(SHAPES.length);
      });
    }

    it(`${name}: Centerline follows the strokes, not the shading`, async () => {
      const { image, truth } = page(background);
      const paths = await traceImageToColoredPaths(image, TRACE_PRESETS['Centerline']!);
      const traced = rasterizePolylines(
        paths.flatMap((p) => p.polylines),
        W,
        H,
      );
      const scores = centerlineScores(traced, truth);
      console.log(
        `[uneven-lighting] ${name} Centerline precision ${scores.precision.toFixed(3)} recall ${scores.recall.toFixed(3)}`,
      );
      expect(scores.precision).toBeGreaterThanOrEqual(0.9);
      expect(scores.recall).toBeGreaterThanOrEqual(0.9);
      // The solid square is still found.
      expect(nearAny(traced, 210, 110, 8)).toBe(true);
    });
  }
});

describe('uniform pages keep the historical global Otsu path', () => {
  const uniform: Array<[string, RawImageData]> = [
    ...PERCEPTUAL_FIXTURES.map((f): [string, RawImageData] => [f.name, f.image]),
    ...[LOGO_LIKE_TRACE_FIXTURE, HOLLOW_LOGO_TRACE_FIXTURE, SKETCH_CONTRAST_TRACE_FIXTURE].map(
      (f): [string, RawImageData] => [f.name, f.image],
    ),
    ['filled star', filledStarImage()],
    ...CENTERLINE_TRUTH_FIXTURES.map((f): [string, RawImageData] => [f.name, f.image]),
    ['ink on flat grey paper', page(() => 235).image],
  ];
  for (const [name, image] of uniform) {
    it(`${name}: thresholds the unmodified luma`, () => {
      const result = otsuBinarization(image);
      expect(result.flattened).toBe(false);
      expect(result.source).toBe(image);
    });
  }
});
