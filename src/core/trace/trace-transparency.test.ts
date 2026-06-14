import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACE_OPTIONS, preprocessForTrace } from './trace-image';

describe('Trace Transparency preprocessing', () => {
  it('respects the threshold band so faint alpha does not fill the page', () => {
    const data = new Uint8ClampedArray([
      255,
      255,
      255,
      255, // opaque -> ink when tracing alpha
      0,
      0,
      0,
      1, // nearly transparent -> background
      0,
      0,
      0,
      126, // below default alpha cutoff -> background
      255,
      255,
      255,
      127, // default boundary -> ink
    ]);

    const result = preprocessForTrace(
      { width: 4, height: 1, data },
      {
        ...DEFAULT_TRACE_OPTIONS,
        cutoffLuma: 0,
        thresholdLuma: 128,
        traceTransparency: true,
      },
    );

    expect(Array.from(result.data)).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]);
  });
});
