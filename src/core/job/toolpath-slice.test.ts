import { describe, expect, it } from 'vitest';

import type { Vec2 } from '../scene';
import { sliceToolpath } from './toolpath-slice';
import type { Toolpath, ToolpathStep } from './toolpath-types';

// A slice reads the partial step's length while truncating it; nothing else in a
// warm slice may touch a step. Anything above this per-call budget means the cut
// index is still being found by walking every step.
const MAX_LENGTH_READS_PER_WARM_SLICE = 4;
// Randomized float lengths make the prefix sum and the old repeated subtraction
// associate differently, so the consumed length agrees to rounding, not to bits.
const MAX_SLICE_LENGTH_DRIFT_MM = 1e-9;
const LCG_MULTIPLIER = 1_664_525;
const LCG_INCREMENT = 1_013_904_223;
const LCG_MODULUS = 0x1_0000_0000;
const QUARTER_MM = 0.25;

describe('sliceToolpath', () => {
  it('reads each step length once per route instead of once per slice', () => {
    const stepCount = 500;
    const counted = countingTravelSteps(stepCount);
    const toolpath: Toolpath = { steps: counted.steps, totalLength: stepCount };

    sliceToolpath(toolpath, stepCount * 0.9);
    const warmedAt = counted.reads();
    for (let call = 0; call < 8; call += 1) sliceToolpath(toolpath, stepCount * 0.9);

    expect(counted.reads() - warmedAt).toBeLessThanOrEqual(8 * MAX_LENGTH_READS_PER_WARM_SLICE);
  });

  it('matches the linear-walk reference across randomized toolpaths and cuts', () => {
    const random = seededRandom(20_260_802);
    for (let trial = 0; trial < 60; trial += 1) {
      const steps = randomSteps(random, dyadicLength);
      const toolpath = toolpathOf(steps);
      for (const cut of sampleCuts(random, steps, toolpath.totalLength)) {
        expectSliceMatchesReference(toolpath, cut);
      }
    }
  });

  it('lands on the same step for arbitrary float lengths', () => {
    const random = seededRandom(7_310_071);
    for (let trial = 0; trial < 40; trial += 1) {
      const steps = randomSteps(random, (rng) => rng() * 10 + 0.001);
      const toolpath = toolpathOf(steps);
      const cut = random() * toolpath.totalLength;
      const expected = referenceSlicePoint(steps, cut);
      const sliced = sliceToolpath(toolpath, cut);

      expect(sliced.whole).toHaveLength(expected.index);
      expect(sliced.partial?.length ?? expected.remaining).toBeCloseTo(
        expected.remaining,
        -Math.log10(MAX_SLICE_LENGTH_DRIFT_MM),
      );
    }
  });

  it('returns every step and no partial when the cut reaches the end', () => {
    const toolpath = toolpathOf(randomSteps(seededRandom(1), dyadicLength));

    const sliced = sliceToolpath(toolpath, toolpath.totalLength);

    expect(sliced.whole).toEqual(toolpath.steps);
    expect(sliced.partial).toBeNull();
  });

  it('returns no steps at the start of the route', () => {
    const toolpath = toolpathOf([travelStep(0, 10)]);

    const sliced = sliceToolpath(toolpath, 0);

    expect(sliced.whole).toEqual([]);
    expect(sliced.partial).toBeNull();
    expect(sliced.head).toEqual({ x: 0, y: 0 });
  });

  it('keeps zero-length steps whole when the cut sits exactly on a boundary', () => {
    const zeroLength: ToolpathStep = {
      kind: 'travel',
      from: { x: 10, y: 0 },
      to: { x: 10, y: 0 },
      length: 0,
    };
    const toolpath = toolpathOf([travelStep(0, 10), zeroLength, travelStep(10, 10)]);

    const sliced = sliceToolpath(toolpath, 10);

    expect(sliced.whole).toHaveLength(2);
    expect(sliced.partial?.length).toBe(0);
    expect(sliced.head).toEqual({ x: 10, y: 0 });
  });
});

function expectSliceMatchesReference(toolpath: Toolpath, cut: number): void {
  const expected = referenceSlicePoint(toolpath.steps, cut);
  const sliced = sliceToolpath(toolpath, cut);
  if (cut <= 0 || cut >= toolpath.totalLength) return;

  expect(sliced.whole).toEqual(toolpath.steps.slice(0, expected.index));
  if (expected.index >= toolpath.steps.length) {
    expect(sliced.partial).toBeNull();
    return;
  }
  expect(sliced.partial?.kind).toBe(toolpath.steps[expected.index]?.kind);
  expect(sliced.partial?.length).toBe(expected.remaining);
  expect(sliced.head).toEqual(sliced.partial === null ? null : headOfReference(sliced.partial));
}

/**
 * The pre-cache linear walk, kept as the oracle: it decides which step the cut
 * lands in and how much of that step is consumed. The truncation math itself is
 * unchanged, so matching both values proves the sliced result is unchanged too.
 */
function referenceSlicePoint(
  steps: ReadonlyArray<ToolpathStep>,
  cut: number,
): { readonly index: number; readonly remaining: number } {
  let remaining = cut;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (step === undefined) continue;
    if (remaining >= step.length) {
      remaining -= step.length;
      continue;
    }
    return { index, remaining };
  }
  return { index: steps.length, remaining };
}

function headOfReference(step: ToolpathStep): Vec2 | null {
  if (step.kind === 'travel') return step.to;
  if (step.kind === 'plunge') return step.at;
  return step.polyline[step.polyline.length - 1] ?? null;
}

function toolpathOf(steps: ReadonlyArray<ToolpathStep>): Toolpath {
  return { steps, totalLength: steps.reduce((sum, step) => sum + step.length, 0) };
}

// Quarter-millimetre lengths are exact in binary floating point, so the prefix
// sum and the old repeated subtraction agree bit for bit and the oracle can be
// compared with strict equality.
function dyadicLength(random: () => number): number {
  return (Math.floor(random() * 64) + 1) * QUARTER_MM;
}

function randomSteps(
  random: () => number,
  lengthOf: (random: () => number) => number,
): ReadonlyArray<ToolpathStep> {
  const count = Math.floor(random() * 12) + 1;
  const steps: ToolpathStep[] = [];
  for (let index = 0; index < count; index += 1) {
    const length = lengthOf(random);
    const kind = Math.floor(random() * 3);
    if (kind === 0) steps.push(travelStep(index, length));
    else if (kind === 1) steps.push(cutStep(index, length));
    else steps.push({ kind: 'plunge', at: { x: index, y: 0 }, fromZ: 0, toZ: -length, length });
  }
  return steps;
}

function sampleCuts(
  random: () => number,
  steps: ReadonlyArray<ToolpathStep>,
  totalLength: number,
): ReadonlyArray<number> {
  const boundaries: number[] = [];
  let running = 0;
  for (const step of steps) {
    running += step.length;
    boundaries.push(running, running - QUARTER_MM / 2, running + QUARTER_MM / 2);
  }
  return [
    0,
    totalLength,
    totalLength / 2,
    Math.floor(random() * 4 * totalLength) / 4,
    ...boundaries,
  ];
}

function travelStep(index: number, length: number): ToolpathStep {
  return { kind: 'travel', from: { x: index, y: 0 }, to: { x: index + length, y: 0 }, length };
}

function cutStep(index: number, length: number): ToolpathStep {
  return {
    kind: 'cut',
    color: '#123456',
    polyline: [
      { x: index, y: 0 },
      { x: index + length / 2, y: 0 },
      { x: index + length, y: 0 },
    ],
    length,
  };
}

function countingTravelSteps(count: number): {
  readonly steps: ReadonlyArray<ToolpathStep>;
  readonly reads: () => number;
} {
  let reads = 0;
  const steps: ToolpathStep[] = [];
  for (let index = 0; index < count; index += 1) {
    const step = { kind: 'travel' as const, from: { x: index, y: 0 }, to: { x: index + 1, y: 0 } };
    Object.defineProperty(step, 'length', {
      enumerable: true,
      get: () => {
        reads += 1;
        return 1;
      },
    });
    // The counter has to live on the property itself, so the literal cannot
    // declare `length` and no structural narrowing can reach ToolpathStep.
    steps.push(step as unknown as ToolpathStep);
  }
  return { steps, reads: () => reads };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
    return state / LCG_MODULUS;
  };
}
