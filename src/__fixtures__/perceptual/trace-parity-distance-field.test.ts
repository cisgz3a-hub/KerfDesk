// Corpus half of the distance-field identity proof (ADR-438 amendment, speed
// wave 2). Gated on TRACE_PARITY=1 like the parity oracle: every mask the real
// tracer builds from the oracle corpus, in all six presets, must give a
// squared distance field that is Object.is-equal, element for element, to the
// frozen column-major reference. TRACE_PARITY_HEAVY=1 adds the heavy cases.

import { describe, expect, it, vi } from 'vitest';
import { TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import type { TraceOptions } from '../../core/trace';
import type * as DistanceField from '../../core/trace/centerline/distance-field';
import type { InkMask } from '../../core/trace/centerline/distance-field';
import { PARITY_PRESETS, parityCases } from './trace-parity-oracle';

const RUN = process.env['TRACE_PARITY'] === '1';
const HEAVY = process.env['TRACE_PARITY_HEAVY'] === '1';

// Masks checked so far, and the first mismatch seen (empty when none).
const seen = vi.hoisted(() => ({ masks: 0, mismatch: '' }));

vi.mock('../../core/trace/centerline/distance-field', async (importOriginal) => {
  const actual = await importOriginal<typeof DistanceField>();
  const { referenceSquaredDistanceField } =
    await import('../../core/trace/centerline/distance-field-reference.test-support');
  return {
    ...actual,
    *squaredDistanceFieldSteps(mask: InkMask) {
      const result = yield* actual.squaredDistanceFieldSteps(mask);
      seen.masks += 1;
      if (seen.mismatch === '') {
        const expected = referenceSquaredDistanceField(mask);
        const at = expected.findIndex((value, i) => !Object.is(value, result[i]));
        if (at >= 0 || expected.length !== result.length) {
          seen.mismatch = `${mask.width}x${mask.height} at ${at}`;
        }
      }
      return result;
    },
  };
});

describe.skipIf(!RUN)('distance field on the oracle corpus masks', () => {
  it('matches the frozen reference on every mask the tracer builds', async () => {
    for (const entry of parityCases().filter((c) => HEAVY || !c.heavy)) {
      for (const preset of PARITY_PRESETS) {
        await traceImageToColoredPaths(entry.image(), TRACE_PRESETS[preset] as TraceOptions);
      }
    }
    expect(seen.masks).toBeGreaterThan(0);
    expect(seen.mismatch).toBe('');
  }, 3_600_000);
});
