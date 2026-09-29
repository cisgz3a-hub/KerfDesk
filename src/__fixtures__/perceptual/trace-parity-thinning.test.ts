// Corpus half of the thinning identity proof (ADR-438 amendment, speed wave
// 2). Gated on TRACE_PARITY=1 like the parity oracle: every mask the real
// tracer thins from the oracle corpus, in all six presets, must give a
// skeleton byte-identical to the frozen thinning of 952fb13e3.
// TRACE_PARITY_HEAVY=1 adds the heavy cases.

import { describe, expect, it, vi } from 'vitest';
import { TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import type { TraceOptions } from '../../core/trace';
import type * as MedialThinning from '../../core/trace/centerline/medial-thinning';
import type { InkMask } from '../../core/trace/centerline/distance-field';
import { PARITY_PRESETS, parityCases } from './trace-parity-oracle';

const RUN = process.env['TRACE_PARITY'] === '1';
const HEAVY = process.env['TRACE_PARITY_HEAVY'] === '1';

// Masks checked so far, and the first mismatch seen (empty when none).
const seen = vi.hoisted(() => ({ masks: 0, mismatch: '' }));

vi.mock('../../core/trace/centerline/medial-thinning', async (importOriginal) => {
  const actual = await importOriginal<typeof MedialThinning>();
  const { referenceThinToMedialAxis } =
    await import('../../core/trace/centerline/medial-thinning-reference.test-support');
  return {
    ...actual,
    *thinToMedialAxisSteps(mask: InkMask, distSq: Float64Array) {
      const result = yield* actual.thinToMedialAxisSteps(mask, distSq);
      seen.masks += 1;
      if (seen.mismatch === '') {
        const expected = referenceThinToMedialAxis(mask, distSq);
        const at = expected.findIndex((value, i) => value !== result[i]);
        if (at >= 0 || expected.length !== result.length) {
          seen.mismatch = `${mask.width}x${mask.height} at ${at}`;
        }
      }
      return result;
    },
  };
});

describe.skipIf(!RUN)('medial thinning on the oracle corpus masks', () => {
  it('matches the frozen reference on every mask the tracer thins', async () => {
    for (const entry of parityCases().filter((c) => HEAVY || !c.heavy)) {
      for (const preset of PARITY_PRESETS) {
        await traceImageToColoredPaths(entry.image(), TRACE_PRESETS[preset] as TraceOptions);
      }
    }
    expect(seen.masks).toBeGreaterThan(0);
    expect(seen.mismatch).toBe('');
  }, 3_600_000);
});
