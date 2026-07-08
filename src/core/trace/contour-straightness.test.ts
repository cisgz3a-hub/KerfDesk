// Straightness instrument for the contour backend (own-engine quality gate).
//
// IoU-class metrics are blind to sub-pixel waviness along a nominally
// straight edge — a wobbly outline can rasterize to the IDENTICAL mask — so
// this test measures what the operator actually sees: the perpendicular
// deviation of the traced outline from the analytic edge of a rotated bar
// whose mask boundary carries deterministic threshold-style jitter (the
// wobbly-stem defect on thresholded photos/screenshots). The counterpart
// fixture guards the other direction: drawn waves with amplitude above the
// flattener's cap must SURVIVE — straightening is for noise, not for art.

import { describe, expect, it } from 'vitest';
import { traceImageToContourColoredPaths } from './contour-trace';
import type { RawImageData, TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';

const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;

const SIZE = 192;
const RGBA_CHANNELS = 4;
const INK = 0;
const PAPER = 255;
const OPAQUE = 255;

// Bar geometry: rotated so no stage can lean on axis alignment.
const BAR_ANGLE_RAD = (20 * Math.PI) / 180;
const AXIS_X = Math.cos(BAR_ANGLE_RAD);
const AXIS_Y = Math.sin(BAR_ANGLE_RAD);
const NORMAL_X = -AXIS_Y;
const NORMAL_Y = AXIS_X;
const HALF_LENGTH_PX = 70;
const HALF_WIDTH_PX = 24;
// Corner neighbourhoods are excluded from edge metrics (corner rebuild owns
// them); a sample must also sit near the nominal edge to count for it.
const EDGE_LENGTH_MARGIN_PX = 15;
const EDGE_CAPTURE_WINDOW_PX = 4;

const TAU = Math.PI * 2;

type Jitter = (t: number) => number;

// Multi-frequency, zero-mean, deterministic threshold-style noise. The long
// 34/29px wavelengths are the class that survives local Taubin smoothing and
// Douglas-Peucker (amplitude above the 0.45px epsilon) — the reported wobble.
const jitterTop: Jitter = (t) =>
  0.5 * Math.sin((TAU * t) / 34) +
  0.3 * Math.sin((TAU * t) / 13 + 1.3) +
  0.2 * Math.sin((TAU * t) / 5.2 + 0.7);
const jitterBottom: Jitter = (t) =>
  0.5 * Math.sin((TAU * t) / 29 + 0.4) +
  0.3 * Math.sin((TAU * t) / 11 + 2.1) +
  0.2 * Math.sin((TAU * t) / 4.7 + 1.9);
// Drawn waves: amplitude far above the flattener's amplitude cap.
const drawnWave: Jitter = (t) => 2.5 * Math.sin((TAU * t) / 48);

function renderBar(top: Jitter, bottom: Jitter): RawImageData {
  const data = new Uint8ClampedArray(SIZE * SIZE * RGBA_CHANNELS);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const sx = x + 0.5 - SIZE / 2;
      const sy = y + 0.5 - SIZE / 2;
      const t = sx * AXIS_X + sy * AXIS_Y;
      const d = sx * NORMAL_X + sy * NORMAL_Y;
      const inked =
        Math.abs(t) <= HALF_LENGTH_PX &&
        d <= HALF_WIDTH_PX + top(t) &&
        d >= -(HALF_WIDTH_PX + bottom(t));
      const base = (y * SIZE + x) * RGBA_CHANNELS;
      const value = inked ? INK : PAPER;
      data[base] = value;
      data[base + 1] = value;
      data[base + 2] = value;
      data[base + 3] = OPAQUE;
    }
  }
  return { width: SIZE, height: SIZE, data };
}

type EdgeWaviness = {
  readonly rmsPx: number;
  readonly maxPx: number;
  readonly samples: number;
};

// Sampling step along each drawn segment — the app renders the chords
// between output points literally, so the metric must measure the chords,
// not only the vertices (a flattened edge keeps very FEW vertices).
const SEGMENT_SAMPLE_STEP_PX = 1.5;

// Waviness of one long edge: mean-centred spread of the drawn outline's
// perpendicular offsets from the nominal edge line, sampled densely along
// every output segment. Mean-centring scores STRAIGHTNESS independent of
// sub-pixel placement (the same convention as the audit's self-fit radial
// RMS for discs).
function edgeWaviness(
  polylines: ReadonlyArray<{
    readonly points: ReadonlyArray<{ x: number; y: number }>;
    readonly closed: boolean;
  }>,
  edgeSign: 1 | -1,
): EdgeWaviness {
  const deviations: number[] = [];
  for (const polyline of polylines) {
    for (const p of sampleAlongSegments(polyline.points, polyline.closed)) {
      const sx = p.x - SIZE / 2;
      const sy = p.y - SIZE / 2;
      const t = sx * AXIS_X + sy * AXIS_Y;
      const d = sx * NORMAL_X + sy * NORMAL_Y;
      if (Math.abs(t) > HALF_LENGTH_PX - EDGE_LENGTH_MARGIN_PX) continue;
      const offset = edgeSign * d - HALF_WIDTH_PX;
      if (Math.abs(offset) > EDGE_CAPTURE_WINDOW_PX) continue;
      deviations.push(offset);
    }
  }
  if (deviations.length === 0) return { rmsPx: Infinity, maxPx: Infinity, samples: 0 };
  const mean = deviations.reduce((s, v) => s + v, 0) / deviations.length;
  let sumSq = 0;
  let max = 0;
  for (const v of deviations) {
    const centred = v - mean;
    sumSq += centred * centred;
    max = Math.max(max, Math.abs(centred));
  }
  return { rmsPx: Math.sqrt(sumSq / deviations.length), maxPx: max, samples: deviations.length };
}

function* sampleAlongSegments(
  points: ReadonlyArray<{ x: number; y: number }>,
  closed: boolean,
): Generator<{ x: number; y: number }> {
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = points[i] as { x: number; y: number };
    const b = points[(i + 1) % points.length] as { x: number; y: number };
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(length / SEGMENT_SAMPLE_STEP_PX));
    for (let s = 0; s < steps; s += 1) {
      const u = s / steps;
      yield { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
  }
}

describe('contour backend straightness (Line Art defaults)', () => {
  it('traces a threshold-jittered straight bar dead straight', () => {
    const paths = traceImageToContourColoredPaths(renderBar(jitterTop, jitterBottom), LINE_ART);
    const polylines = paths.flatMap((p) => p.polylines);
    const top = edgeWaviness(polylines, 1);
    const bottom = edgeWaviness(polylines, -1);
    // Enough spline samples must land on each long edge for the metric to
    // mean anything.
    expect(top.samples).toBeGreaterThanOrEqual(10);
    expect(bottom.samples).toBeGreaterThanOrEqual(10);
    // The jitter is zero-mean noise: a straight-line fit is the truth.
    expect(top.rmsPx).toBeLessThanOrEqual(0.22);
    expect(bottom.rmsPx).toBeLessThanOrEqual(0.22);
    expect(top.maxPx).toBeLessThanOrEqual(0.6);
    expect(bottom.maxPx).toBeLessThanOrEqual(0.6);
  });

  it('preserves drawn waves above the flattening cap', () => {
    const paths = traceImageToContourColoredPaths(renderBar(drawnWave, drawnWave), LINE_ART);
    const polylines = paths.flatMap((p) => p.polylines);
    const top = edgeWaviness(polylines, 1);
    expect(top.samples).toBeGreaterThanOrEqual(10);
    // The 2.5px wave is intentional geometry — flattening must not touch it.
    expect(top.maxPx).toBeGreaterThanOrEqual(1.8);
  });
});
