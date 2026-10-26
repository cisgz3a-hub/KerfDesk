// Audit 07-P2-1, the Free default: Line Art auto-promotes a colour logo to the
// local-contrast mask (ADR-401), whose window must stay whole on the tapered
// grid of 1100-1200 px sources (ADR-438). Before the fix those sizes added
// spurious rings (a corner triangle among them) and ran 5-10x slower.
import { describe, expect, it } from 'vitest';
import type { ColoredPath } from '../scene';
import { shouldUseSketchTrace } from './auto-sketch-trace';
import type { RawImageData } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';
import { traceScalePlan } from './trace-upscale-policy';

const LINE_ART = TRACE_PRESETS['Line Art']!;

/** A thin gold ring, fourteen 2 px gold bars and a solid red disc. */
function colourLogo(n: number): RawImageData {
  const data = new Uint8ClampedArray(n * n * 4).fill(255);
  const gold = [182, 128, 24, 255];
  const red = [200, 30, 40, 255];
  const c = n / 2;
  for (let y = 0; y < n; y += 1)
    for (let x = 0; x < n; x += 1) {
      const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (Math.abs(r - n * 0.42) <= 1.2) data.set(gold, (y * n + x) * 4);
      if (r <= n * 0.12) data.set(red, (y * n + x) * 4);
    }
  for (let bar = 0; bar < 14; bar += 1) {
    const x0 = Math.round(n * (0.25 + bar * 0.036));
    for (let y = Math.round(n * 0.72); y < Math.round(n * 0.8); y += 1)
      for (let x = x0; x < x0 + 2; x += 1) data.set(gold, (y * n + x) * 4);
  }
  return { width: n, height: n, data };
}

function rings(paths: readonly ColoredPath[]) {
  return paths.flatMap((path) => path.polylines);
}

// The 1000 px logo takes the exact 2x grid; traced once for every case.
let reference: Promise<number> | undefined;
function referenceRingCount(): Promise<number> {
  reference ??= traceImageToColoredPaths(colourLogo(1000), LINE_ART).then(
    (paths) => rings(paths).length,
  );
  return reference;
}

describe('Line Art on a colour logo in the supersample taper band', () => {
  it.each([1100, 1150, 1200])(
    'traces a %i px logo like the exact 2x grid traces it at 1000 px',
    async (n) => {
      const image = colourLogo(n);
      expect(shouldUseSketchTrace(image, LINE_ART)).toBe(true);
      const plan = traceScalePlan(image, LINE_ART);
      expect(plan.kind === 'upscale' && !Number.isInteger(plan.factor)).toBe(true);

      const traced = rings(await traceImageToColoredPaths(image, LINE_ART));
      // Before: 28 / 24 / 32 rings against 17.
      expect(traced).toHaveLength(await referenceRingCount());
      expect(
        traced.filter(({ points }) => points.every((p) => p.x > n - 16 && p.y > n - 16)),
      ).toEqual([]);
    },
    180_000,
  );
});
