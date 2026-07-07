// Roundness instrument for the contour backend (own-engine gate) — the arc
// counterpart of contour-straightness.test.ts.
//
// Large smooth curves traced from real sources carry mid-wavelength mask
// noise (±1px dents over 10-30px) that local Taubin smoothing cannot reach
// and the straight-run flattener deliberately protects (arcs must not be
// flattened into secants). The maintainer sees it as "a small wobble in the
// O". This instrument renders a ring whose boundary carries deterministic
// threshold-style jitter and measures the drawn outline's radial deviation
// from its own best-fit circle; a drawn-wave ring guards the other
// direction — intentional waves must survive.

import { describe, expect, it } from 'vitest';
import { traceImageToContourColoredPaths } from './contour-trace';
import { fitCircleThroughRun } from './run-fit';
import type { RawImageData, TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';

const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;

const SIZE = 224;
const RGBA_CHANNELS = 4;
const CX = SIZE / 2;
const CY = SIZE / 2;
const OUTER_R = 88;
const INNER_R = 58;
const SEGMENT_SAMPLE_STEP_PX = 1.5;

type Jitter = (t: number) => number;

const TAU = Math.PI * 2;
// Deterministic multi-frequency threshold noise, t = circumferential arc
// length. Wavelengths are calibrated to the DEFECT CLASS the maintainer
// reported (dents spanning ~10-20px on the HOUSE "O"); undulation at 30px+
// wavelength is indistinguishable from drawn art (the logo's waves) for a
// LOCAL curve model and deliberately does not appear here — on straight
// runs the global line model handles it instead (contour-straightness).
const jitterOuter: Jitter = (t) =>
  0.5 * Math.sin((TAU * t) / 21) +
  0.3 * Math.sin((TAU * t) / 9 + 1.3) +
  0.2 * Math.sin((TAU * t) / 4.2 + 0.7);
const jitterInner: Jitter = (t) =>
  0.5 * Math.sin((TAU * t) / 19 + 0.4) +
  0.3 * Math.sin((TAU * t) / 8 + 2.1) +
  0.2 * Math.sin((TAU * t) / 3.8 + 1.9);
// Drawn waves far above the evening cap — must survive.
const drawnWave: Jitter = (t) => 2.5 * Math.sin((TAU * t) / 48);

function renderRing(outer: Jitter, inner: Jitter): RawImageData {
  const data = new Uint8ClampedArray(SIZE * SIZE * RGBA_CHANNELS);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const sx = x + 0.5 - CX;
      const sy = y + 0.5 - CY;
      const r = Math.hypot(sx, sy);
      const theta = Math.atan2(sy, sx);
      // Arc-length coordinate at each boundary's own radius keeps the
      // jitter wavelengths physical (px along the curve).
      const inked =
        r <= OUTER_R + outer((theta + Math.PI) * OUTER_R) &&
        r >= INNER_R + inner((theta + Math.PI) * INNER_R);
      const base = (y * SIZE + x) * RGBA_CHANNELS;
      const value = inked ? 0 : 255;
      data[base] = value;
      data[base + 1] = value;
      data[base + 2] = value;
      data[base + 3] = 255;
    }
  }
  return { width: SIZE, height: SIZE, data };
}

type Roundness = { readonly rmsPx: number; readonly maxPx: number; readonly samples: number };

// Radial deviation of the drawn outline (segments densely sampled) from its
// own best-fit circle — the self-fit convention the audit's disc metric
// uses, scoring SHAPE independent of sub-pixel placement.
function ringRoundness(
  points: ReadonlyArray<{ x: number; y: number }>,
  closed: boolean,
): Roundness {
  const samples: Array<{ x: number; y: number }> = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = points[i] as { x: number; y: number };
    const b = points[(i + 1) % points.length] as { x: number; y: number };
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(length / SEGMENT_SAMPLE_STEP_PX));
    for (let s = 0; s < steps; s += 1) {
      const u = s / steps;
      samples.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    }
  }
  if (samples.length === 0) return { rmsPx: Infinity, maxPx: Infinity, samples: 0 };
  // The centre comes from a least-squares CIRCLE fit, not the sample
  // centroid: evening leaves vertex density non-uniform around the ring,
  // and a density-dragged centroid reads as a fake first-harmonic wobble
  // (measured: rms 0.86 from a 2px centroid displacement on a ring whose
  // true-centre rms was 0.07).
  const circle = fitCircleThroughRun(samples, 0, samples.length - 1);
  if (circle === null) return { rmsPx: Infinity, maxPx: Infinity, samples: samples.length };
  const radii = samples.map((p) => Math.hypot(p.x - circle.cx, p.y - circle.cy));
  const mean = radii.reduce((s, r) => s + r, 0) / radii.length;
  let sumSq = 0;
  let max = 0;
  for (const r of radii) {
    const dev = r - mean;
    sumSq += dev * dev;
    max = Math.max(max, Math.abs(dev));
  }
  return { rmsPx: Math.sqrt(sumSq / radii.length), maxPx: max, samples: samples.length };
}

function largestLoops(image: RawImageData): Array<{
  points: ReadonlyArray<{ x: number; y: number }>;
  closed: boolean;
}> {
  const paths = traceImageToContourColoredPaths(image, LINE_ART);
  return paths
    .flatMap((p) => p.polylines)
    .sort((a, b) => b.points.length - a.points.length)
    .slice(0, 2);
}

describe('contour backend roundness (Line Art defaults)', () => {
  it('traces a threshold-jittered ring round (both boundaries)', () => {
    const loops = largestLoops(renderRing(jitterOuter, jitterInner));
    expect(loops.length).toBe(2);
    for (const loop of loops) {
      const r = ringRoundness(loop.points, loop.closed);
      expect(r.samples).toBeGreaterThanOrEqual(60);
      // Staged bars: the dense-stage circle smoother brought the RMS from
      // 1.06px to ~0.25 (4x); isolated spots where the jitter components
      // align into feature-scale geometry are deliberately left by the
      // residual gate (never smooth what might be drawn), so the max stays
      // ~1.2px. Sub-0.2 RMS needs a cleaner INPUT boundary (sub-pixel mask
      // extraction from the anti-aliased luma) — the named next lever;
      // these bars pin the achieved level against regression.
      expect(r.rmsPx).toBeLessThanOrEqual(0.3);
      expect(r.maxPx).toBeLessThanOrEqual(1.3);
    }
  });

  it('preserves drawn waves above the evening cap', () => {
    const loops = largestLoops(renderRing(drawnWave, drawnWave));
    expect(loops.length).toBe(2);
    const outer = loops[0] as NonNullable<(typeof loops)[0]>;
    const r = ringRoundness(outer.points, outer.closed);
    // The 2.5px wave is intentional geometry — evening must not erase it.
    expect(r.maxPx).toBeGreaterThanOrEqual(1.8);
  });
});
