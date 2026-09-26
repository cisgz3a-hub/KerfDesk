// Edge placement on synthetic anti-aliased fixtures (ADR-453, ADR-456): the
// crack-chain layer (mid-crack chain of the traced mask, interpolated by the
// walker's field) against the analytic edge. The finishing stages above it
// are unchanged by these levels, so the chain is where the gain is measured.

import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { inkMaskFromPrepared } from './centerline';
import { midCrackChain, traceBoundaryLoops, type CrackSubPixelField } from './contour-boundary';
import { bandCrossing, isoCrossing } from './crack-iso-levels';
import {
  alphaDiscImage,
  discCoverage,
  lumaImage,
  radiusStats,
  type Disc,
  type RadiusStats,
} from './edge-precision-fixtures.test-support';
import { TRACE_PRESETS, type RawImageData, type TraceOptions } from './index';
import { otsuThreshold } from './preprocess';
import { prepareTraceForContour } from './trace-image';

const DISC: Disc = { cx: 100.3, cy: 99.6, r: 60 };
const SIZE = 260;
const preset = (name: string): TraceOptions => TRACE_PRESETS[name] as TraceOptions;

type Chains = { readonly placed: Polyline[]; readonly cutOnly: Polyline[] };

// Mid-crack chains of the traced mask, with the walker's field and with the
// same field stripped of its crossing hook (the arithmetic before ADR-453).
function chains(image: RawImageData, options: TraceOptions): Chains {
  const prep = prepareTraceForContour(image, options);
  const loops = traceBoundaryLoops(inkMaskFromPrepared(prep.prepared));
  const field = prep.crackField ?? undefined;
  const cutField: CrackSubPixelField | undefined =
    field === undefined ? undefined : { lumaAt: field.lumaAt, thresholdAt: field.thresholdAt };
  const walk = (f: CrackSubPixelField | undefined): Polyline[] =>
    loops.map((loop) => ({ points: midCrackChain(loop.points, f), closed: true }));
  return { placed: walk(field), cutOnly: walk(cutField) };
}

// Anti-aliased black disc on white paper; `grey` paints a paper patch of that
// luma at x >= patchX (pulls the automatic cut away from the mid-level).
function discOnPaper(grey = 255, patchX = SIZE): RawImageData {
  return lumaImage(SIZE, (x, y) => {
    const paper = x >= patchX && x < SIZE - 10 && y >= 10 && y < SIZE - 10 ? grey : 255;
    return paper * (1 - discCoverage(x, y, DISC));
  });
}

function expectPrecise(stats: RadiusStats, rms = 0.06): void {
  expect(stats.samples).toBeGreaterThan(100);
  expect(Math.abs(stats.bias)).toBeLessThanOrEqual(0.03);
  expect(stats.rms).toBeLessThanOrEqual(rms);
}

describe('isoCrossing / bandCrossing', () => {
  it('interpolates against the iso only across a crack the cut straddles', () => {
    expect(isoCrossing(0, 200, 100, 100)).toBeCloseTo(0.5);
    expect(isoCrossing(40, 200, 100, 120)).toBeCloseTo(0.5);
    expect(isoCrossing(40, 140, 150, 120)).toBe(0.5); // paper sample below the cut
    expect(isoCrossing(0, 255, 60, 127.5)).toBe(0.5); // saturated step
    expect(isoCrossing(90, 110, 100, 20)).toBe(0.9); // clamped
  });

  it('crosses at the band edge the paper sample lies beyond', () => {
    // Ink band 60..180: paper above crosses at 180, paper below at 60.
    expect(bandCrossing(105, 255, 60, 180)).toBeCloseTo(0.5);
    expect(bandCrossing(105, 15, 60, 180)).toBeCloseTo(0.5);
    expect(bandCrossing(100, 20, 60, 180)).toBeCloseTo(0.5);
    expect(bandCrossing(40, 255, 60, 180)).toBe(0.5); // ink sample outside: cleanup flip
    expect(bandCrossing(255, 0, 60, 255)).toBe(0.5); // saturated reversed step
  });
});

describe('automatic cut: plateau mid-level on broad edges (ADR-453)', () => {
  it('places an anti-aliased disc at 50% coverage on Smooth and Sharp', () => {
    for (const name of ['Smooth', 'Sharp'])
      expectPrecise(radiusStats(chains(discOnPaper(), preset(name)).placed, DISC));
  });

  it('removes the inward bias when the automatic cut lands far below the mid-level', () => {
    const image = discOnPaper(180, 170);
    expect(otsuThreshold(image)).toBeLessThanOrEqual(115);
    const { placed, cutOnly } = chains(image, preset('Smooth'));
    expect(radiusStats(cutOnly, DISC).bias).toBeLessThan(-0.06);
    expectPrecise(radiusStats(placed, DISC), 0.065);
  });

  it('uses the local paper level where the disc meets grey paper', () => {
    const { placed, cutOnly } = chains(discOnPaper(150, 130), preset('Sharp'));
    const before = radiusStats(cutOnly, DISC);
    const after = radiusStats(placed, DISC);
    expect(Math.abs(after.bias)).toBeLessThanOrEqual(0.03);
    expect(after.rms).toBeLessThan(0.7 * before.rms);
  });

  it('keeps the crossing of the cut on a thin stroke', () => {
    const image = lumaImage(120, (x, y) => {
      const across = Math.abs(y + 0.5 - (30 + 0.6 * (x + 0.5)));
      return x >= 10 && x < 100 ? 255 * Math.max(0, Math.min(1, across - 0.2)) : 255;
    });
    const { placed, cutOnly } = chains(image, preset('Smooth'));
    expect(placed.length).toBeGreaterThan(0);
    expect(placed).toEqual(cutOnly);
  });

  it('leaves Line Art (explicit threshold) on the plain field', () => {
    const prep = prepareTraceForContour(discOnPaper(180, 170), preset('Line Art'));
    expect(prep.crackField?.crackCrossingAt).toBeUndefined();
  });
});

describe('alpha route and Cutoff > 0 bands (ADR-456)', () => {
  it('traces an alpha cut-out disc at 50% coverage', () => {
    const disc: Disc = { cx: 70.4, cy: 69.7, r: 40 };
    const options = { ...preset('Sharp'), traceTransparency: true };
    const { placed } = chains(alphaDiscImage(140, disc), options);
    expectPrecise(radiusStats(placed, disc));
  });

  it('places both edges of a mid-grey band ring', () => {
    const outer: Disc = { cx: 110.3, cy: 109.6, r: 70 };
    const inner: Disc = { cx: 110.3, cy: 109.6, r: 40 };
    const ring = lumaImage(220, (x, y) => {
      const co = discCoverage(x, y, outer);
      const ci = discCoverage(x, y, inner);
      return 255 * (1 - co) + 105 * (co - ci) + 15 * ci;
    });
    const options = { ...preset('Sharp'), cutoffLuma: 60, thresholdLuma: 180 };
    const { placed } = chains(ring, options);
    expectPrecise(radiusStats(placed, outer));
    expectPrecise(radiusStats(placed, inner));
  });

  it('keeps the plain threshold field on the default band', () => {
    const prep = prepareTraceForContour(discOnPaper(), { ...preset('Sharp'), cutoffLuma: 0 });
    expect(prep.crackField?.crackCrossingAt).toBeUndefined();
  });
});
