// Perf audit S1, S5-P3-1: ADR-530 Amendment 13's clean-art check prepares the
// source before Sharp traces it. Sharp's trace on the source grid reuses that
// preparation, and a source the check refuses on sight is not prepared for it,
// so a Sharp trace prepares its source once, as before the amendment.

import type * as TraceImage from './trace-image';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawImageData, TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

const preparations = vi.hoisted(() => ({ count: 0 }));

vi.mock('./trace-image', async (importOriginal) => {
  const actual = await importOriginal<typeof TraceImage>();
  return {
    ...actual,
    prepareTraceForContour: (...args: Parameters<typeof actual.prepareTraceForContour>) => {
      preparations.count += 1;
      return actual.prepareTraceForContour(...args);
    },
  };
});

const SHARP = TRACE_PRESETS['Sharp'] as TraceOptions;
const CANVAS = 320;

beforeEach(() => {
  preparations.count = 0;
});

// A disc of black ink, sampled 4 × 4 per pixel when soft.
function disc(soft: boolean): RawImageData {
  const cx = CANVAS / 2 + 0.31;
  const cy = CANVAS / 2 + 0.17;
  const r = CANVAS * 0.33;
  const data = new Uint8ClampedArray(CANVAS * CANVAS * 4).fill(255);
  for (let y = 0; y < CANVAS; y += 1) {
    for (let x = 0; x < CANVAS; x += 1) {
      let covered = 0;
      const samples = soft ? 4 : 1;
      for (let j = 0; j < samples; j += 1) {
        for (let i = 0; i < samples; i += 1) {
          const inside = Math.hypot(x + (i + 0.5) / samples - cx, y + (j + 0.5) / samples - cy) < r;
          if (inside) covered += 1;
        }
      }
      const level = Math.round(255 * (1 - covered / (samples * samples)));
      data.set([level, level, level], (y * CANVAS + x) * 4);
    }
  }
  return { width: CANVAS, height: CANVAS, data };
}

describe('Sharp prepares its source once (perf audit S5-P3-1)', () => {
  it('skips the check’s preparation for black-and-white art', async () => {
    const paths = await traceImageToColoredPaths(disc(false), SHARP);
    expect(paths.length).toBeGreaterThan(0);
    expect(preparations.count).toBe(1);
  });

  it('traces an anti-aliased source from the preparation the check made', async () => {
    const paths = await traceImageToColoredPaths(disc(true), SHARP);
    expect(paths.length).toBeGreaterThan(0);
    expect(preparations.count).toBe(1);
  });
});
