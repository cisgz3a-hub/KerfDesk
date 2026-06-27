// Ground-truth centerline fixtures. Each is a black stroke on white whose
// medial axis is known by construction: a pixel is inked iff its centre lies
// within strokeWidth/2 of the analytic centerline. So we can measure a trace's
// centering to sub-pixel accuracy, its connectivity through junctions, and its
// spur-freeness — none of which a structural (path-count) test can see.
//
// Fixtures probe the known failure modes: straight + diagonal (basic centering,
// 8-connectivity), an L corner (one stroke must stay one polyline through a
// bend), a cross (two strokes must stay connected THROUGH the junction, not
// shatter into four stubs), and an arc (curved centering).
//
// Pure, deterministic, test-only (src/__fixtures__ is boundary/coverage-exempt).

import type { RawImageData } from '../../core/trace';
import type { Polyline, Vec2 } from '../../core/scene';
import { minDistanceToPolylines } from './centerline-geometry';

export type CenterlineTruthFixture = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly image: RawImageData; // black stroke(s) on white — what the tracer sees
  readonly centerlines: ReadonlyArray<Polyline>; // analytic truth skeleton (open)
  readonly strokeWidthPx: number;
  readonly expectedStrokeCount: number; // connected strokes once junctions are chained
};

const RGBA_CHANNELS = 4;
const INK = 0;
const PAPER = 255;
const OPAQUE = 255;
const SIZE = 128;
const STROKE_WIDTH_PX = 9;

type SourceInkDecorator = (data: Uint8ClampedArray, width: number, height: number) => void;

function line(...points: ReadonlyArray<Vec2>): Polyline {
  return { points: [...points], closed: false };
}

function arc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): Polyline {
  const steps = 32;
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const deg = startDeg + ((endDeg - startDeg) * i) / steps;
    const rad = (deg * Math.PI) / 180;
    points.push({ x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) });
  }
  return { points, closed: false };
}

function renderStroke(
  name: string,
  centerlines: ReadonlyArray<Polyline>,
  expectedStrokeCount: number,
  decorateSource?: SourceInkDecorator,
): CenterlineTruthFixture {
  const half = STROKE_WIDTH_PX / 2;
  const data = new Uint8ClampedArray(SIZE * SIZE * RGBA_CHANNELS);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const inked = minDistanceToPolylines({ x: x + 0.5, y: y + 0.5 }, centerlines) <= half;
      const base = (y * SIZE + x) * RGBA_CHANNELS;
      const value = inked ? INK : PAPER;
      data[base] = value;
      data[base + 1] = value;
      data[base + 2] = value;
      data[base + 3] = OPAQUE;
    }
  }
  decorateSource?.(data, SIZE, SIZE);
  return {
    name,
    width: SIZE,
    height: SIZE,
    image: { width: SIZE, height: SIZE, data },
    centerlines,
    strokeWidthPx: STROKE_WIDTH_PX,
    expectedStrokeCount,
  };
}

function paintInkRect(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
): void {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const base = (y * width + x) * RGBA_CHANNELS;
      data[base] = INK;
      data[base + 1] = INK;
      data[base + 2] = INK;
      data[base + 3] = OPAQUE;
    }
  }
}

export const CENTERLINE_TRUTH_FIXTURES: ReadonlyArray<CenterlineTruthFixture> = [
  renderStroke('h-stroke', [line({ x: 24, y: 64 }, { x: 104, y: 64 })], 1),
  renderStroke('h-stroke-noisy-spur', [line({ x: 24, y: 64 }, { x: 104, y: 64 })], 1, (data) => {
    paintInkRect(data, SIZE, 64, 54, 1, 5);
  }),
  renderStroke('diagonal-stroke', [line({ x: 24, y: 24 }, { x: 104, y: 104 })], 1),
  renderStroke('l-corner', [line({ x: 32, y: 28 }, { x: 32, y: 96 }, { x: 100, y: 96 })], 1),
  renderStroke(
    'cross',
    [line({ x: 24, y: 64 }, { x: 104, y: 64 }), line({ x: 64, y: 24 }, { x: 64, y: 104 })],
    2,
  ),
  renderStroke('arc', [arc(96, 96, 64, 180, 270)], 1),
];
