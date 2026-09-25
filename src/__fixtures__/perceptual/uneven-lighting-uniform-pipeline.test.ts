// Pipeline-level proof that background flattening (ADR-394) leaves uniform
// pages on the exact historical path. Each fixture is traced twice through
// the real preprocessing chain (adjustments, median, the Smooth supersample,
// the detail detector's own pass): once as shipped, and once with
// levelForAutomaticThreshold forced to identity, which is the pre-ADR-394
// chain (applyThresholdWithIso then runs its own Otsu cut on the unmodified
// luma). The traced paths must be identical. A ramp page is the positive
// control: there the two runs must differ, so the bypass is known to bite.

import { describe, expect, it, vi } from 'vitest';
import { TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import type { RawImageData } from '../../core/trace';
import type * as BackgroundFlatten from '../../core/trace/background-flatten';
import { PERCEPTUAL_FIXTURES } from './shapes';
import { filledStarImage } from './star-fixture';
import {
  HOLLOW_LOGO_TRACE_FIXTURE,
  LOGO_LIKE_TRACE_FIXTURE,
  SKETCH_CONTRAST_TRACE_FIXTURE,
} from './trace-fixtures';

const gate = vi.hoisted(() => ({ bypass: false, flattenedCalls: 0 }));

vi.mock('../../core/trace/background-flatten', async (importOriginal) => {
  const actual = await importOriginal<typeof BackgroundFlatten>();
  return {
    ...actual,
    levelForAutomaticThreshold: (
      image: RawImageData,
      options: Parameters<typeof actual.levelForAutomaticThreshold>[1],
    ) => {
      if (gate.bypass) return { source: image, threshold: null };
      const level = actual.levelForAutomaticThreshold(image, options);
      if (level.source !== image) gate.flattenedCalls += 1;
      return level;
    },
  };
});

const PRESETS = ['Smooth', 'Sharp', 'Centerline'] as const;

// The uneven-lighting ink set: a 200×5 bar, a 5×90 bar and a 20×20 square.
function isInk(x: number, y: number): boolean {
  if (x >= 20 && x < 220 && y >= 10 && y < 15) return true;
  if (x >= 30 && x < 35 && y >= 40 && y < 130) return true;
  return x >= 200 && x < 220 && y >= 100 && y < 120;
}

function inkOnPaper(background: (x: number) => number): RawImageData {
  const W = 400;
  const H = 200;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const v = isInk(x, y) ? 60 : Math.round(background(x));
      data.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return { width: W, height: H, data };
}

async function traceBoth(
  image: RawImageData,
  preset: (typeof PRESETS)[number],
): Promise<{ readonly shipped: string; readonly historical: string; readonly flattened: number }> {
  gate.bypass = false;
  gate.flattenedCalls = 0;
  const shipped = JSON.stringify(await traceImageToColoredPaths(image, TRACE_PRESETS[preset]!));
  const flattened = gate.flattenedCalls;
  gate.bypass = true;
  try {
    const historical = JSON.stringify(
      await traceImageToColoredPaths(image, TRACE_PRESETS[preset]!),
    );
    return { shipped, historical, flattened };
  } finally {
    gate.bypass = false;
  }
}

describe('uniform pages trace exactly as before ADR-394', () => {
  const uniform: Array<[string, RawImageData]> = [
    ...PERCEPTUAL_FIXTURES.map((f): [string, RawImageData] => [f.name, f.image]),
    ...[LOGO_LIKE_TRACE_FIXTURE, HOLLOW_LOGO_TRACE_FIXTURE, SKETCH_CONTRAST_TRACE_FIXTURE].map(
      (f): [string, RawImageData] => [f.name, f.image],
    ),
    ['filled star', filledStarImage()],
    ['ink on flat grey paper', inkOnPaper(() => 235)],
  ];
  for (const [name, image] of uniform) {
    for (const preset of PRESETS) {
      it(`${name}: ${preset} paths are identical`, async () => {
        const { shipped, historical, flattened } = await traceBoth(image, preset);
        expect(flattened).toBe(0);
        expect(shipped).toBe(historical);
      });
    }
  }

  it('positive control: the bypass does change an unevenly lit page', async () => {
    const { shipped, historical, flattened } = await traceBoth(
      inkOnPaper((x) => 150 + (100 * x) / 399),
      'Sharp',
    );
    expect(flattened).toBeGreaterThan(0);
    expect(shipped).not.toBe(historical);
  });
});
